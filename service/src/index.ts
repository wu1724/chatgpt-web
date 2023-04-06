import express from 'express'
import type { RequestProps } from './types'
import type { ChatMessage } from './chatgpt'
import { chatConfig, chatReplyProcess, currentModel } from './chatgpt'
import { auth } from './middleware/auth'
import { limiter } from './middleware/limiter'
import { isNotEmptyString } from './utils/is'
import { fetchBalance } from './utils'
import { rand } from '@vueuse/core'
import localApiKeyMap from 'apiKeyMap.json'
import fs from 'fs'
const app = express()
const router = express.Router()
const localFileName = 'apiKeyMap.json'
let apiKeyStatus = true
let apiKeys = process.env.OPENAI_API_KEY.split("\n")
// global.console.log(process.env.OPENAI_API_KEY)
let apiKeyMap = {}
if(localApiKeyMap){
	let { default: _, ...tmp } = localApiKeyMap;
	apiKeyMap = tmp
}
// global.console.log(apiKeyMap)
let apiCanUse = []
let ipToApi = {}

//遍历环境变量中的所有apikey，添加到apiKeyMap中，通过查询已使用额度来确定是否有效
apiKeys.forEach(e => {
	if(!apiKeyMap[e])
		apiKeyMap[e] = {}
	// apiKeyMap[e]['status'] = true
	fetchBalance(e).then(res => {
		// global.console.log(res)
		apiKeyMap[e]['usage'] = res
		if (res < 0 || res > 5) {
			apiKeyMap[e]['status'] = false
		}
		else apiKeyMap[e]['status'] = true
	})
})
//定时任务，定时更新可用apikey的数组
setInterval(() => {
	for (let apiKey in apiKeyMap) {
		let index = apiCanUse.indexOf(apiKey);
		if (!apiKeyMap[apiKey].status) {
			if (index != -1) {
				apiCanUse.splice(index, 1);
			}
		} else {
			if (index == -1) {
				apiCanUse.push(apiKey)
			}
		}
	}
	// global.console.log(apiCanUse)
}, 1000)
//定时刷新余额状态
setInterval(()=>{
	for (let apiKey in apiKeyMap){
		if(apiKeyMap[apiKey].status){
			fetchBalance(apiKey).then(res => {
				// global.console.log(res)
				apiKeyMap[apiKey]['usage'] = res
				if (res < 0 || res > 5) {
					apiKeyMap[apiKey]['status'] = false
				}
				else apiKeyMap[apiKey]['status'] = true
			})
		}
	}
}, 60000)

// setTimeout(()=>{
// global.console.log(apiKeyMap)
// },10000)

setInterval(()=>{
	saveToLocal()
	// global.console.log('保存到本地')
}, 60000)

function getApiKey(ip) {
	if(apiCanUse.length == 0) return ''
	let apiKey = ipToApi[ip]
	if (!apiKey) {
		apiKey = apiCanUse[Math.floor(Math.random() * apiCanUse.length)]
		ipToApi[ip] = apiKey
	}
	// global.console.log(apiKeyMap,ipToApi)
	return apiKey
}

function removeApiKey(apikey) {
	let index = apiCanUse.indexOf(apikey);
	if (index != -1) {
		apiCanUse.splice(index, 1);
	}
}

function saveToLocal(){
	fs.writeFile(localFileName, JSON.stringify(apiKeyMap), function(err) {
	  if (err) throw err;
	});
}

function readFromLocal() : object{
	let dt = ''
	fs.readFile(localFileName, function(err, data) {
		global.console.log(err, data)
		dt = err ? '' : data
	});
	if(isNotEmptyString(dt))
		global.console.log(JSON.parse(dt))
		return JSON.parse(dt)
	return {}
}


app.use(express.static('public'))
app.use(express.json())

app.all('*', (_, res, next) => {
	res.header('Access-Control-Allow-Origin', '*')
	res.header('Access-Control-Allow-Headers', 'authorization, Content-Type')
	res.header('Access-Control-Allow-Methods', '*')
	next()
})

router.post('/chat-process', [auth, limiter], async (req, res) => {
	//根据ip固定请求的apikey
	let apiKey = getApiKey(req.ip)

	//如果没有获取到apikey，直接返回
	if(!isNotEmptyString(apiKey)){
		apiKeyStatus = false
		res.send({
		  message: "暂时不可用，请联系管理员",
		  data: null,
		  status: "Failed",
		})
		return
	}

	res.setHeader('Content-type', 'application/octet-stream')

	try {
		const { prompt, options = {}, systemMessage } = req.body as RequestProps
		let firstChunk = true
		await chatReplyProcess({
			message: prompt,
			lastContext: options,
			process: (chat : ChatMessage) => {
				res.write(firstChunk ? JSON.stringify(chat) : `\n${JSON.stringify(chat)}`)
				firstChunk = false
			},
			systemMessage,
			apiKey
		}, req.ip)
		apiKeyStatus = true
	}
	catch (error) {
		// global.console.log(error)
		if (error.message.indexOf('insufficient_quota') != -1) {
			global.console.log("移除无效key：" + apiKey)
			removeApiKey(apiKey)
			apiKeyMap[apiKey].status = false
			ipToApi[req.ip] = null
			res.status(429).send()
		}
		else
			res.status(502).send()
		// apiKeyStatus = false
		// res.write(JSON.stringify(error))
	}
	finally {
		res.end()
	}
})

router.get('/apiKeyStatus', auth, async (req, res) => {
	res.setHeader('Content-Type', 'application/json');
	let tmp = {}
	for(let i in apiKeyMap){
		let str = i.substring(0,12) + '*********************************' + i.substring(45)
		tmp[str] = {}
		tmp[str].status = apiKeyMap[i].status
		tmp[str].usage = apiKeyMap[i].usage
	}
	res.send(JSON.stringify(tmp, null, 2))
})

router.get('/check', auth, async (req, res) => {
	if (apiKeyStatus)
		res.send()
	else {
		try {
			await chatReplyProcess({
				message: '1+1',
			})
			apiKeyStatus = true
			res.send()
		} catch (error) {
			res.status(429).send()
		}
	}
})


router.post('/config', async (req, res) => {
	try {
		const response = await chatConfig()
		res.send(response)
	}
	catch (error) {
		res.send(error)
	}
})

router.post('/session', async (req, res) => {
	try {
		const AUTH_SECRET_KEY = process.env.AUTH_SECRET_KEY
		const hasAuth = isNotEmptyString(AUTH_SECRET_KEY)
		res.send({ status: 'Success', message: '', data: { auth: hasAuth, model: currentModel() } })
	}
	catch (error) {
		res.send({ status: 'Fail', message: error.message, data: null })
	}
})

router.post('/verify', async (req, res) => {
	try {
		const { token } = req.body as { token : string }
		if (!token)
			throw new Error('Secret key is empty')

		if (process.env.AUTH_SECRET_KEY !== token)
			throw new Error('密钥无效 | Secret key is invalid')

		res.send({ status: 'Success', message: 'Verify successfully', data: null })
	}
	catch (error) {
		res.send({ status: 'Fail', message: error.message, data: null })
	}
})

app.use('', router)
app.use('/api', router)
app.set('trust proxy', 1)

app.listen(3002, () => globalThis.console.log('Server is running on port 3002'))
