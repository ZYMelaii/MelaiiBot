"use strict";

// const { Client } = require('./oicq/lib/oicq');
const { createClient } = require('./oicq'); //! modified
const { getGroupMsgs } = require('./oicq/lib/message/history');
const { parseGroupMsg, Parser } = require('./oicq/lib/message/parser');
const { unzip } = require('./oicq/lib/common');
const pb = require("./oicq/lib/algo/pb");

const plugin = require('./plugin');
const { parseMsg } = require('./message');
const { cloneDeep } = require('lodash');

class MelaiiBot
{
	/// MelaiiBot Members
	//! @QQBot:
	//!     - _client: Client OICQ客户端
	//! @Environment:
	//!     - _current_env: String 当前Bot环境
	//!     - _environments: Map<Map<Map<Function>>> 环境列表
	//!         { env: { event: { subname: action, ... }, ... }, ... }
	//!     - _dispatcher: Map<Function> 事件分发器列表
	//!         { event: dispatcher }
	//!     - _builtin: Array<String> 预置的插件列表，在环境创建时自动安装
	//! @Status:
	//!     - _sleep: Boolean 睡眠状态标志
	//! @Risk Control:
	//!     - _on_riskctrl: Boolean 风控状态标志
	//!     - _riskctrl_count: Integer 风控状态量计数
	//!     - _max_msglen_risk: Integer 风控状态下的消息长度限制
	//! @Shared Field:
	//!     - _sharedfield: Map<Any> 共享变量域
	//!         包括但不限于创建与Bot绑定的插件内存空间
	//! @Unused:
	///     - _count: Integer 缺省的计数变量

	/// MelaiiBot Methods
	//! @QQBot:
	//!     - login(password: String) -> void 登录
	//!     - sendPrivateMsg(uid: Integer, msg: String) -> Map<Any> 发送私人消息
	//!     - sendGroupMsgSafe(gid: Integer, msg: String) -> Map<Any> 安全地发送群消息（分段发送）
	//!     - sendGroupMsg(gid: Integer, msg: String) -> Map<Any> 发送群消息
	//!     - sendMsg(msg: String, target: Map<Integer>) -> Map<Any> 发送消息（自动推断私聊或群聊）
	//!     - withdrawMessage(messageid: String) -> Map<Any> 撤回消息
	//!     - getGroupMemberList(gid: Integer, no_cache: Boolean) -> Map<Any> 获取群成员信息列表
	//! 	- pickGroupMsg(gid: Integer, seq: Integer) -> Map<Any> 获取历史群消息
	//!     - get uin() -> Integer 当前登录账户
	//!     - get friends() -> Map<Map<Any>> 好友列表
	//!     - get groups() -> Map<Map<Any>> 群列表
	//! @Status:
	//!     - get sleep() -> Boolean 睡眠状态
	//! @Environment:
	//!     - newEnvironment(env: String, no_builtin: Boolean) -> MelaiiBot<this> 新建环境
	//!     - switchTo(env: String, force: Boolean) -> MelaiiBot<this> 切换环境
	//!     - get env() -> String 当前环境
	//!     - get envs() -> Array<String> 环境列表
	//!     - set env(env: String) 切换环境
	//! @Event:
	//!     - emit(signal: String, data: Any) -> MelaiiBot<this> 发送信号（产生事件）
	//!     - makeDispatcher(_event: String) -> Function 生成分发器函数
	//!     - addFilter(filterName: String, _event: String ? Array<String>, filter: Function) -> MelaiiBot<this> 添加事件过滤器
	//!     - delFilter(filterName: String) -> MelaiiBot<this> 注销事件过滤器
	//!     - addListener(_event: String, name: String, action: Function) -> MelaiiBot<this> 添加监听单元
	//!     - delListener(_event: String, name: String) -> MelaiiBot<this> 注销监听单元
	//!     - get listener() -> Map<Map<Function>> 当前环境监听器列表
	//! @Plugin:
	//!     - registerPlugin(desc: Map<Any>) -> MelaiiBot<this> 注册插件
	//!     - unregisterPlugin(plugin: String, force: Boolean) -> Integer 移除插件
	//!     - get plugins() -> Array<String> 当前插件列表
	//! @Risk Control:
	//!     - clearRiskControl() -> void 清除风控标记
	//!     - makeRiskctrlMsg(msg: String) -> String 对待发送消息应用风控限制
	//!     - get riskctrl() -> Boolean 当前风控状态
	//!     - set riskctrl(status: Boolean) 设置风控状态
	//! @Shared Field:
	//!     - newShared(field: String) -> Map<Any> 新建共享域
	//!     - delShared(field: String) -> void 删除共享域
	//!     - getShared(field: String) -> Map<Any> 获取共享域
	//! @Logger:
	//!     - trace(...) -> MelaiiBot<this> 跟踪日志
	//!     - mark(...) -> MelaiiBot<this> 标记日志
	//!     - info(...) -> MelaiiBot<this> 信息日志
	//!     - warn(...) -> MelaiiBot<this> 警告日志
	///     - error(...) -> MelaiiBot<this> 错误日志

	//@ param: config: { OICQ::BotConf..., builtin: [Plugins...] }
	constructor(uin, config = null)
	{
		this._client = createClient(uin, {
			ignore_self: config?.ignore_self ?? false, //! 默认接受自己的消息
			log_level:   config?.log_level ?? 'off',   //! 默认不输出日志
			platform:    config?.platform ?? 5         //! 默认登录iPad平台
		});

		this._current_env  = null;
		this._environments = {};
		// this._environments[this._current_env] = {};
		this._filters = {/*name: { events: [...], filter }*/};
		this._dispatchers = { /*event: dispatcher*/ };

		this._sleep = false; //! 睡眠状态（未实现）

		this._builtin = config?.builtin ?? []; //! 核心插件（默认安装）

		//! 风控机制
		//! 风控触发将强制截断群消息为风险模式的最大长度
		//! 消息截断将尽可能的保证消息的完整性
		this._on_riskctrl     = false;
		this._riskctrl_count  = 0;
		this._max_msglen_risk = 100;

		this._sharedfield = {};

		this._counter = 0;
	}

	get uin()
	{
		return this._client.uin;
	}

	get friends()
	{
		return this._client.fl;
	}

	get groups()
	{
		return this._client.gl;
	}

	get sleep()
	{
		return this._sleep;
	}

	/// 自定义事件 system.riskctrl
	//! @note: 二次增添于 oicq/lib/message/builder.js oicq/lib/client.js
	//! @note: event = {
	//!     status: true | false,
	//!     time: Integer<new Date().getTime()>
	//!     message_id: String<Base64>
	/// }

	get riskctrl() { return this._on_riskctrl; }
	get env() { return this._current_env; }
	get envs() { return Object.keys(this._environments); }
	get listener() { return this._environments[this._current_env]; }

	get plugins()
	{
		let actors = [];
		for (let event in this.listener)
		{
			for (let e in this.listener[event])
			{
				if (e[0] != '#') continue;
				let results = e.match(/#(.*?)\./);
				if (results.length >= 2) actors.push(results[1]);
			}
		}
		return [...new Set(actors)];
	}

	set riskctrl(status)
	{
		if (!status && this._riskctrl_count != 0)
		{
			if (this._riskctrl_count > 0) --this._riskctrl_count;
			if (this._riskctrl_count == 0)
			{
				this._on_riskctrl = false;
				this.info('MelaiiBot@riskctrl: cleared risk control flag');
			} else if (this._riskctrl_count < 0)
			{
				this.warn(`MelaiiBot@riskctrl: unexpected riskctrl flag [${this._riskctrl_count}] (reset to 0)`);
				this._riskctrl_count = 0;
			}
		} else
		{
			if (this._riskctrl_count == 0) this._on_riskctrl = true;
			++this._riskctrl_count;
			setTimeout(() => {
				this.riskctrl = false;
			}, 10 * 60 * 1000); //! 启用10分钟的风控限制
			this.info(`MelaiiBot@riskctrl: set risk control flag [${this._riskctrl_count}]`);
		}
	}

	set env(env)
	{
		this.switchTo(env, false);
	}

	newEnvironment(env, no_builtin = false)
	{
		if (!Object.keys(this._environments).includes(env))
		{
			this._environments[env] = {};

			if (!no_builtin)
			{
				let oldenv = this._current_env;
				this._current_env = env;
				this._builtin.forEach((e) => {
					let resp = plugin.register(this, e);
					if (resp.status_code != 0)
					{
						this.warn('MelaiiBot@newEnvironment:',
							`failed installing plugin "${e}" while creating env "${env}" (${resp.errmsg})`);
					}
				});
				this._current_env = oldenv;
			}
		}

		return this;
	}

	switchTo(env, force = false)
	{
		if (this._current_env == env) return this;

		if (Object.keys(this._environments).includes(env))
		{   //! 转换环境
			this._current_env = env;
		} else if (force)
		{   //! 环境不存在，创建新环境
			this.newEnvironment(env);
			this._current_env = env;
		}

		return this;
	}

	emit(signal, data = null)
	{
		this._client.emit(signal, data);
		return this;
	}

	newShared(field)
	{
		this._sharedfield[field] = new Map();
		return this._sharedfield[field];
	}

	delShared(field)
	{
		if (this._sharedfield[field])
		{
			delete this._sharedfield[field];
		}
	}

	getShared(field)
	{
		return this._sharedfield[field];
	}

	clearRiskControl()
	{
		while (this.riskctrl)
		{
			this.riskctrl = false;
		}
	}

	/// 判断事件是否需要执行名为${name}的过滤器测试
	//! @note: 事件的名称是以点号分级的多层次字符串
	//!     如 message.group, message, message.group.anonymous 皆从属于 message 事件
	///     应当接受过滤器测试
	shouldTestFilter(name, event)
	{
		let target_events = this._filters[name].events;
		for (let i in target_events)
		{
			let e = target_events[i];
			if (event.indexOf(e) == 0 && [null, '.']
				.includes(event[e.length] ?? null)) return true;
		}
		return false;
	}

	makeDispatcher(_event)
	{
		return (event) => {
			let info = { bot: this, event: event };
			let keys = Object.keys(this._filters);
			for (let i in keys)
			{
				let key = keys[i];
				let filter = this._filters[key];
				if (this.shouldTestFilter(key, _event))
				{
					if (!filter.filter(info)) return;
				}
			}

			let actions = this.listener[_event];

			info.msg = event.post_type == 'message' ? parseMsg(event.message) : null;
			info.gid = event?.group_id;
			info.uid = event?.user_id;

			for (let key in actions)
			{
				try {
					let shouldContinue = actions[key](info);
					if (!(shouldContinue ?? true)) break;
				} catch(e) {
					this.error(`failed call action "${key}" of ${_event} (${e.message})`);
				}
			}
		};
	}

	/// 添加过滤器
	//! filter 返回 false 代表过滤当前事件
	addFilter(name, _event, _filter = null)
	{
		let events = typeof(_event) == 'string' ? [_event] : _event;

		if (!this._filters[name])
		{
			this._filters[name] = {};
			this._filters[name].events = [];
		}

		let filter = this._filters[name];

		if (!filter.filter && !filter)
		{
			delete this._filters[name];
			return this;
		}

		filter.events = filter.events.concat(events).sort();
		if (!filter.filter)
		{
			filter.filter = _filter;
		}

		return this;
	}

	delFilter(name)
	{
		if (Object.keys(this._filters).includes(name)) delete this._filters[name];
		return this;
	}

	/// 添加监听器
	//! @author: ZYmelaii
	/// @param: action: function({ bot: MelaiiBot, event: EventData })
	addListener(_event, name, action)
	{
		if (this.listener == null) return this;

		if (this.listener[_event] == null)
		{
			this.listener[_event] = {};
			if (this._dispatchers[_event] == null)
			{
				this._dispatchers[_event] = this.makeDispatcher(_event);
				this._client.on(_event, this._dispatchers[_event]);
			}
		}

		this.listener[_event][name] = action;

		return this;
	}

	//! 删除监听器
	delListener(event, name)
	{
		if (this.listener[event] != null)
		{
			if (this.listener[event][name] != null)
			{
				delete this.listener[event][name];
			}

			if (Object.keys(this.listener[event]).length == 0)
			{
				delete this.listener[event];
			}
		}

		return this;
	}

	/// 从描述档案注册插件
	//! @param: desc: { plugin: str, actions: [{
	///     event: event, subname: str, action: function },...] }
	registerPlugin(desc)
	{
		let root = desc.plugin;

		desc.actions.forEach((e) => {
			this.addListener(e.event, `#${root}.${e.subname}`, e.action);
		});

		let shared = this.newShared(root); //! 创建插件的共享内存域
		if (desc?.setup) desc.setup(this, shared);

		return this;
	}

	/// MelaiiBot::unregisterPlugin
	//! @intro: 卸载插件
	//! @param: plugin: String 插件名称
	/// @return: 卸载的插件节点总数，卸载失败时返回-1
	unregisterPlugin(plugin, force = false)
	{
		let removed = 0;

		if (!(this._builtin.includes(plugin) && !force))
		{
			let events = Object.keys(this.listener);
			events.forEach((event) => {
				let names = Object.keys(this.listener[event]);
				names.forEach((name) => {
					if (name.indexOf(`#${plugin}`) == 0)
					{
						this.delListener(event, name);
						++removed;
					}
				});
			});
			plugin.transfer(plugin, (desc) => {
				if (desc?.uninstall) desc.uninstall(this);
			});
			this.delShared(plugin);
		} else
		{
			this.error(`MelaiiBot@unregisterPlugin:`,
				`attemp to unregister builtin plugin "${plugin}" without force flag`);
			removed = -1;
		}

		return removed;
	}

	login(password)
	{
		if (password)
		{
			this._client.login(password);
		} else
		{
			this._client.once("system.login.qrcode", (event) => {
				process.stdin.once("data", () => {
					this._client.login();
				});
			}).login();
		}
	}

	makeRiskctrlMsg(msg)
	{
		let msgpiece = msg.split('\n');
		let newmsg = '';
		if (msgpiece.length == 1
			|| msgpiece[0].length > this._max_msglen_risk)
		{
			newmsg = msg.slice(0, this._max_msglen_risk);
		} else
		{
			for (let i in msgpiece)
			{
				let tmp = `${newmsg}\n${msgpiece[i]}`;
				if (tmp.length > this._max_msglen_risk) break;
				newmsg = tmp;
			}
		}
		return `[风控] ${newmsg}`;
	}

	async sendGroupMsgSafe(gid, msg)
	{
		if (this.riskctrl) msg = this.makeRiskctrlMsg(msg);
		let result = await this._client.sendGroupMsg(gid, msg);
		return result;
	}

	async sendMsg(msg, target)
	{
		const uid = target?.uid;
		const gid = target?.gid;

		if (!uid && !gid) return null;

		while (msg = msg.replace('\r', '\n'), msg.indexOf('\r') != -1);

		if (msg.length > 1024)
		{
			this.warn('MelaiiBot@sendMsg: msg too long (longer than 1024)');
			return null;
		}

		let resp = gid
			? await this.sendGroupMsgSafe(gid, msg)
			: await this._client.sendPrivateMsg(uid, msg);

		if (resp?.data?.riskctrl != null)
		{
			this.emit('system.riskctrl', {
				status: resp?.data?.riskctrl,
				time: new Date().getTime(),
				message_id: resp?.data?.message_id
			});
		}

		return resp;
	}

	async sendPrivateMsg(uid, msg)
	{
		return await this.sendMsg(msg, { uid: uid });
	}

	async sendGroupMsg(gid, msg)
	{
		return await this.sendMsg(msg, { gid: gid });
	}

	async withdrawMessage(messageid)
	{
		return await this._client.deleteMsg(messageid);
	}

	async getGroupMemberList(gid, no_cache = false)
	{
		return (await this._client.getGroupMemberList(gid, no_cache))?.data;
	}

	async pickGroupMsg(gid, seq)
	{
		let pb_body = pb.encode({ 1: gid, 2: seq/*from_seq*/, 3: seq/*to_seq*/, 6: 0 });
		let blob;

		try {
			blob = await this._client.sendUni("MessageSvc.PbGetGroupMsg", pb_body);
		} catch(e) {
			this.error(e.message);
			return { status: -1, err: e.message }; //! 未知错误1
		}

		let o = pb.decode(blob);
		if (o[1] > 0) return { status: 1, err: '消息获取失败' };

		let raw_msg = o[6];/*Array.isArray(o[6]) ? o[6] : [o[6]]*/;
		const head = raw_msg[1], content = raw_msg[2], body = raw_msg[3];

		let time = head[6];

		let user_id = head[1], group_id = head[9][1];
		let rich  = body[1];

		let elems = rich[2];

		if (!Array.isArray(elems) && elems[1][1] == '[已删除]')
		{
			return { status: 2, err: '消息已撤回' };
		}

		let parser;
		try {
			parser = await Parser.invoke(this._client, user_id, group_id, rich);
		} catch(e) {
			return { status: -2, err: e.message }; //! 未知错误2
		}

		parser.time = time; //! 获取真实时间 new Date(time * 1000)

		return { status: 0, data: parser };
	}

	//! logger
	trace()
	{
		console.log(
			`\x1b[34m[${new Date().toISOString()}] [TRACE]\x1b[0m -`,
			...arguments);
		return this;
	}

	info()
	{
		console.log(
			`\x1b[37m[${new Date().toISOString()}] [INFO]\x1b[0m -`,
			...arguments);
		return this;
	}

	mark()
	{
		console.warn(
			`\x1b[36m[${new Date().toISOString()}] [MARK]\x1b[0m -`,
			...arguments);
		return this;
	}

	warn()
	{
		console.warn(
			`\x1b[33m[${new Date().toISOString()}] [WARN]\x1b[0m -`,
			...arguments);
		return this;
	}

	error()
	{
		console.error(
			`\x1b[31m[${new Date().toISOString()}] [ERROR]\x1b[0m -`,
			...arguments);
		return this;
	}
};

function CreateBot(account, config) {
	let bot = new MelaiiBot(account, config);
	return bot.switchTo('normal', true);
}

module.exports =
{
	MelaiiBot,
	CreateBot
};
