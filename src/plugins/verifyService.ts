import fs from "node:fs";
import path from "node:path";
import type { Context, Logger } from "koishi";
import type { Config } from "../index";
import * as utils from "../utils";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 10;
const PREFIX_LENGTH = 6;
const TTL_MS = 5 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 30_000;
const MAX_PENDING = 1000;
const TOKEN_PREFIX = "sfx_";
const TOKEN_RANDOM_LEN = 16;

interface VerifyEntry {
	fullCode: string;
	createdAt: number;
	verified: boolean;
	token?: string;
	mode: "login" | "reset";
}

interface AutoTokensFile {
	roles: {
		owner: string;
		admin: string[];
	};
	users: {
		[qqId: string]: {
			token: string;
			username: string;
			platform: string;
			groups: Record<string, string>;
		};
	};
}

function randomCode(length: number): string {
	let code = "";
	for (let i = 0; i < length; i++) {
		code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
	}
	return code;
}

function randomToken(): string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let t = TOKEN_PREFIX;
	for (let i = 0; i < TOKEN_RANDOM_LEN; i++) {
		t += chars[Math.floor(Math.random() * chars.length)];
	}
	return t;
}

export type Role = "user" | "admin" | "owner";

export class VerifyService {
	private pending = new Map<string, VerifyEntry>();
	private timer: (() => void) | null = null;
	private log: Logger;

	private get autoTokensPath(): string {
		return path.join(
			this.ctx.baseDir,
			"data/starfx-bot/assets",
			"auto-tokens.json",
		);
	}

	constructor(
		private ctx: Context,
		private cfg: Config,
		private ownerId: string,
	) {
		this.log = this.ctx.logger("starfx-bot");
	}

	// ========== 生命周期 ==========

	start() {
		this.timer = this.ctx.setInterval(
			() => this.cleanup(),
			CLEANUP_INTERVAL_MS,
		);
		this.ctx.on("dispose", () => this.stop());
	}

	stop() {
		if (this.timer) {
			this.timer();
			this.timer = null;
		}
		this.pending.clear();
	}

	// ========== HTTP API ==========

	requestVerify(
		qqId: string,
		mode: "login" | "reset" = "login",
	): string | null {
		if (this.pending.size >= MAX_PENDING && !this.pending.has(qqId))
			return null;
		const fullCode = randomCode(CODE_LENGTH);
		this.pending.set(qqId, {
			fullCode,
			createdAt: Date.now(),
			verified: false,
			mode,
		});
		return fullCode;
	}

	checkVerify(fullCode: string): { verified: boolean; token: string | null } {
		for (const [, entry] of this.pending) {
			if (entry.fullCode === fullCode) {
				if (Date.now() - entry.createdAt > TTL_MS)
					return { verified: false, token: null };
				return { verified: entry.verified, token: entry.token ?? null };
			}
		}
		return { verified: false, token: null };
	}

	async addGroup(
		token: string,
		rawGroupId: string,
	): Promise<{
		success: boolean;
		message: string;
		groupId?: string;
		groupName?: string;
	}> {
		const data = this.load();
		const qqId = this.findQqIdByToken(data, token);
		if (!qqId) return { success: false, message: "Token 无效" };
		const entry = data.users[qqId];
		const fullGid = `${entry.platform}:${rawGroupId}`;
		if (entry.groups[fullGid])
			return { success: false, message: "该群已在列表中" };

		const bot = this.ctx.bots.find((b) => b.platform === entry.platform);
		if (!bot)
			return {
				success: false,
				message: `未找到 ${entry.platform} 平台的机器人`,
			};

		const featureControl = utils.parseFeatureControl(this.cfg.featureControl);
		if (!utils.detectControl(featureControl, rawGroupId, "record")) {
			return { success: false, message: "该群未启用语录功能" };
		}
		try {
			const member = await bot.getGuildMember(rawGroupId, qqId);
			if (!member) return { success: false, message: "你不在该群中" };
		} catch {
			return { success: false, message: "查询群成员失败，请确认群号正确" };
		}
		let groupName = fullGid;
		try {
			const guild = await bot.getGuild(rawGroupId);
			if (guild?.name) groupName = guild.name;
		} catch {}

		entry.groups[fullGid] = groupName;
		this.save(data);
		return { success: true, message: "添加成功", groupId: fullGid, groupName };
	}

	revokeToken(token: string): { success: boolean; message: string } {
		const data = this.load();
		const qqId = this.findQqIdByToken(data, token);
		if (!qqId) return { success: false, message: "Token 无效" };
		delete data.users[qqId];
		this.pending.delete(qqId);
		this.save(data);
		return { success: true, message: "已撤销" };
	}

	// ========== QQ 命令 ==========

	async verifyCommand(
		qqId: string,
		platform: string,
		prefix: string,
	): Promise<string> {
		if (prefix.length !== PREFIX_LENGTH) return "验证码格式错误";
		const entry = this.pending.get(qqId);
		if (!entry) return "没有待验证的请求，请先在网页上获取验证码";
		if (Date.now() - entry.createdAt > TTL_MS) {
			this.pending.delete(qqId);
			return "验证码已过期，请重新在网页上获取";
		}
		if (!entry.fullCode.startsWith(prefix)) return "验证码错误";

		const data = this.load();
		const existingUser = data.users[qqId];
		let token: string;

		if (entry.mode === "login" && existingUser) {
			// 验证码登录 → 复用已有 token
			token = existingUser.token;
		} else {
			// 重置模式 或 首次验证 → 生成新 token
			token = randomToken();
		}

		entry.verified = true;
		entry.token = token;

		let username = qqId;
		for (const bot of this.ctx.bots) {
			try {
				const user = await bot.getUser(qqId);
				if (user?.nickname || user?.name) {
					username = (user.nickname || user.name) ?? qqId;
					break;
				}
			} catch {}
		}

		data.users[qqId] = {
			token,
			username,
			platform,
			groups: data.users[qqId]?.groups ?? {},
		};
		this.save(data);
		return "";
	}

	resetByQqId(qqId: string): { success: boolean; message: string } {
		this.pending.delete(qqId);
		const data = this.load();
		if (!data.users[qqId])
			return { success: false, message: "你还没有绑定 Token" };
		delete data.users[qqId];
		this.save(data);
		return { success: true, message: "已重置，请重新验证" };
	}

	async removeGroup(
		qqId: string,
		platform: string,
		rawGroupId: string,
	): Promise<{ success: boolean; message: string }> {
		const data = this.load();
		const entry = data.users[qqId];
		if (!entry) return { success: false, message: "你还没有绑定 Token" };
		const fullGid = `${platform}:${rawGroupId}`;
		if (!entry.groups[fullGid])
			return { success: false, message: "该群不在你的列表中" };
		delete entry.groups[fullGid];
		this.save(data);
		return { success: true, message: "已移除" };
	}

	// ========== 角色查询 ==========

	getRoleByQqId(qqId: string): Role {
		const data = this.load();
		if (data.roles.owner === qqId) return "owner";
		if (data.roles.admin.includes(qqId)) return "admin";
		return "user";
	}

	getRoleByToken(token: string): Role {
		const data = this.load();
		const qqId = this.findQqIdByToken(data, token);
		return qqId ? this.getRoleByQqId(qqId) : "user";
	}

	getLabelByToken(token: string): string {
		const data = this.load();
		const qqId = this.findQqIdByToken(data, token);
		if (!qqId) return `${String(token).substring(0, 8)}…`;
		const entry = data.users[qqId];
		return entry ? `${entry.username}(${qqId})` : qqId;
	}

	// ========== 权限管理（owner） ==========

	setRole(
		operatorQqId: string,
		targetQqId: string,
		role: Role,
	): { success: boolean; message: string } {
		if (this.getRoleByQqId(operatorQqId) !== "owner") {
			return { success: false, message: "权限不足" };
		}
		if (operatorQqId === targetQqId) {
			return { success: false, message: "不能修改自己的权限" };
		}
		if (role === "owner" && operatorQqId !== this.ownerId) {
			return {
				success: false,
				message: "只有配置文件中指定的 owner 才能授予 owner 权限",
			};
		}
		if (role === "owner" && targetQqId !== this.ownerId) {
			return { success: false, message: "owner 已由配置文件指定，无法更改" };
		}

		const data = this.load();
		const targetEntry = data.users[targetQqId];
		if (!targetEntry) return { success: false, message: "目标用户未验证" };

		// 从所有角色中移除
		if (data.roles.owner === targetQqId) data.roles.owner = this.ownerId;
		data.roles.admin = data.roles.admin.filter((id) => id !== targetQqId);

		if (role === "admin") {
			data.roles.admin.push(targetQqId);
		} else if (role === "owner") {
			data.roles.owner = targetQqId;
		}

		this.save(data);
		return {
			success: true,
			message: `已将 ${targetEntry.username} 设为 ${role}`,
		};
	}

	listUsers(operatorQqId: string) {
		if (this.getRoleByQqId(operatorQqId) !== "owner") {
			return { success: false, message: "权限不足" };
		}
		const data = this.load();
		const users = Object.entries(data.users).map(([qqId, e]) => ({
			qqId,
			username: e.username,
			role: this.getRoleByQqId(qqId),
		}));
		return { success: true, users };
	}

	deleteUser(
		operatorQqId: string,
		targetQqId: string,
	): { success: boolean; message: string } {
		if (this.getRoleByQqId(operatorQqId) !== "owner") {
			return { success: false, message: "权限不足" };
		}
		if (targetQqId === operatorQqId)
			return { success: false, message: "不能删除自己" };
		if (targetQqId === this.ownerId)
			return { success: false, message: "无法删除配置文件中指定的 owner" };

		const data = this.load();
		if (!data.users[targetQqId])
			return { success: false, message: "目标用户不存在" };

		delete data.users[targetQqId];
		if (data.roles.owner === targetQqId) data.roles.owner = this.ownerId;
		data.roles.admin = data.roles.admin.filter((id) => id !== targetQqId);
		this.pending.delete(targetQqId);
		this.save(data);
		return { success: true, message: "已删除" };
	}

	// ========== HTTP API 代理（token → qqId 转换） ==========

	private findQqIdByToken(data: AutoTokensFile, token: string): string | null {
		for (const [qqId, e] of Object.entries(data.users)) {
			if (e.token === token) return qqId;
		}
		return null;
	}

	listUsersByToken(token: string): {
		success: boolean;
		users?: { qqId: string; username: string; role: string }[];
		message?: string;
		selfQqId?: string;
	} {
		const qqId = this.findQqIdByToken(this.load(), token);
		if (!qqId) return { success: false, message: "Token 无效" };
		const result = this.listUsers(qqId);
		return { ...result, selfQqId: result.success ? qqId : undefined };
	}

	setRoleByToken(token: string, targetQqId: string, role: string) {
		const qqId = this.findQqIdByToken(this.load(), token);
		if (!qqId) return { success: false, message: "Token 无效" };
		return this.setRole(qqId, targetQqId, role as Role);
	}

	deleteUserByToken(token: string, targetQqId: string) {
		const qqId = this.findQqIdByToken(this.load(), token);
		if (!qqId) return { success: false, message: "Token 无效" };
		return this.deleteUser(qqId, targetQqId);
	}

	// ========== 内部实现 ==========

	private cleanup() {
		const now = Date.now();
		for (const [qqId, entry] of this.pending) {
			if (now - entry.createdAt > TTL_MS) this.pending.delete(qqId);
		}
	}

	private defaultData(): AutoTokensFile {
		return { roles: { owner: this.ownerId, admin: [] }, users: {} };
	}

	private load(): AutoTokensFile {
		try {
			if (fs.existsSync(this.autoTokensPath)) {
				return JSON.parse(fs.readFileSync(this.autoTokensPath, "utf8"));
			}
		} catch (e) {
			this.log.warn("读取 auto-tokens.json 失败", e);
		}
		return this.defaultData();
	}

	private save(data: AutoTokensFile) {
		try {
			const dir = path.dirname(this.autoTokensPath);
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(
				this.autoTokensPath,
				JSON.stringify(data, null, 2),
				"utf8",
			);
		} catch (e) {
			this.log.error("写入 auto-tokens.json 失败", e);
		}
	}
}
