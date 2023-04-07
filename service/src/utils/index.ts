import exp from "constants"

interface SendResponseOptions<T = any> {
	type : 'Success' | 'Fail'
	message ?: string
	data ?: T
}

export function sendResponse<T>(options : SendResponseOptions<T>) {
	if (options.type === 'Success') {
		return Promise.resolve({
			message: options.message ?? null,
			data: options.data ?? null,
			status: options.type,
		})
	}

	// eslint-disable-next-line prefer-promise-reject-errors
	return Promise.reject({
		message: options.message ?? 'Failed',
		data: options.data ?? null,
		status: options.type,
	})
}


import fetch from 'node-fetch'
import { isNotEmptyString } from '../utils/is'
import type { BalanceResponse, RequestOptions } from '../chatgpt/types'

export async function fetchBalance(apikey) {
	// 计算起始日期和结束日期

	const OPENAI_API_KEY = apikey
	const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL

	if (!isNotEmptyString(OPENAI_API_KEY))
		return Promise.resolve('-')

	const API_BASE_URL = isNotEmptyString(OPENAI_API_BASE_URL)
		? OPENAI_API_BASE_URL
		: 'https://api.openai.com'

	const [startDate, endDate] = formatDate()

	// 每月使用量
	const urlUsage = `${API_BASE_URL}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`

	const headers = {
		'Authorization': `Bearer ${OPENAI_API_KEY}`,
		'Content-Type': 'application/json',
	}

	try {
		// 获取已使用量
		const useResponse = await fetch(urlUsage, { headers })
		const usageData = await useResponse.json() as BalanceResponse
		const usage = Math.round(usageData.total_usage) / 100
		return Promise.resolve(usage)
	}
	catch {
		return Promise.resolve(-1)
	}
}

function formatDate() : string[] {
	const today = new Date()
	const year = today.getFullYear()
	const month = today.getMonth() + 1
	const lastDay = new Date(year, month, 0)
	const formattedFirstDay = `${year}-${month.toString().padStart(2, '0')}-01`
	const formattedLastDay = `${year}-${month.toString().padStart(2, '0')}-${lastDay.getDate().toString().padStart(2, '0')}`
	return [formattedFirstDay, formattedLastDay]
}

export async function checkBilling(apiKey) {
	const OPENAI_API_BASE_URL = process.env.OPENAI_API_BASE_URL
	const apiUrl = isNotEmptyString(OPENAI_API_BASE_URL)
		? OPENAI_API_BASE_URL
		: 'https://api.openai.com'
	// 计算起始日期和结束日期
	const [startDate, endDate] = formatDate()

	// 设置API请求URL和请求头
	const urlSubscription = apiUrl + '/v1/dashboard/billing/subscription'; // 查是否订阅
	const urlBalance = apiUrl + '/dashboard/billing/credit_grants'; // 查普通账单
	const urlUsage =
		apiUrl + `/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`; // 查使用量
	const headers = {
		"Authorization": "Bearer " + apiKey,
		"Content-Type": "application/json"
	};

	try {
		// 获取API限额
		let response = await fetch(urlSubscription, {
			headers
		});
		// if (!response.ok) {
		// 	console.log("您的账户已被封禁，请登录OpenAI进行查看。");
		// 	return;
		// }
		const subscriptionData = await response.json();

		// 判断是否过期
		const timestamp_now = Math.floor(Date.now() / 1000);
		const timestamp_expire = subscriptionData.access_until;
		// if (timestamp_now > timestamp_expire) {
		// 	alert("您的账户额度已过期, 请登录OpenAI进行查看。");
		// }

		const totalAmount = subscriptionData.hard_limit_usd;
		const is_subsrcibed = subscriptionData.has_payment_method;

		// 获取已使用量
		response = await fetch(urlUsage, {
			headers
		});
		const usageData = await response.json();
		const totalUsage = usageData.total_usage / 100;

		// 如果用户绑卡，额度每月会刷新
		// if (is_subsrcibed) {
		// 	// 获取当前月的第一天日期
		// 	const day = now.getDate(); // 本月过去的天数
		// 	startDate = new Date(now - (day - 1) * 24 * 60 * 60 * 1000); // 本月第一天
		// 	urlUsage =
		// 		apiUrl + `/v1/dashboard/billing/usage?start_date=${formatDate(startDate)}&end_date=${formatDate(endDate)}`; // 查使用量
		// 	response = await fetch(urlUsage, {
		// 		headers
		// 	});
		// 	usageData = await response.json();
		// 	totalUsage = usageData.total_usage / 100;
		// }

		// 计算剩余额度
		const remaining = totalAmount - totalUsage;

		// 输出总用量、总额及余额信息
		// console.log(`Total Amount: ${totalAmount.toFixed(2)}`);
		// console.log(`Used: ${totalUsage.toFixed(2)}`);
		// console.log(`Remaining: ${remaining.toFixed(2)}`);

		return Promise.resolve([totalAmount, totalUsage, remaining]);
	} catch (error) {
		console.error(error);
		// alert("您的IP无法访问OpenAI，请在OpenAI服务范围内查询。");
		return Promise.resolve([null, null, null]);
	}
}
