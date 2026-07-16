import type { Context } from "koishi";
import type { Config } from "../index";
import type { VerifyService } from "./verifyService";

interface KoaCtx {
	request: { body?: Record<string, unknown>; headers: Record<string, string> };
	get(name: string): string;
	status: number;
	body: unknown;
}

export function runRecordApi(
	ctx: Context,
	cfg: Config,
	verifyService: VerifyService,
) {
	const { initLog } = require("./logService");
	initLog(ctx.baseDir);

	if (ctx.server) {
		const secretGuard = (kctx: KoaCtx) => {
			if (kctx.get("x-secret") !== cfg.apiSecret) {
				kctx.status = 401;
				kctx.body = { error: "unauthorized" };
				return false;
			}
			return true;
		};

		ctx.server.post(
			"/starfx/api/record/verify-request",
			async (kctx: KoaCtx) => {
				if (!secretGuard(kctx)) return;
				const body = kctx.request.body ?? {};
				const qqId = body.qqId;
				if (!qqId) {
					kctx.status = 400;
					kctx.body = { error: "missing qqId" };
					return;
				}
				const fullCode = verifyService.requestVerify(
					String(qqId),
					body.mode === "reset" ? "reset" : "login",
				);
				if (fullCode === null) {
					kctx.status = 429;
					kctx.body = { error: "too many requests" };
					return;
				}
				kctx.body = { fullCode };
			},
		);

		ctx.server.post("/starfx/api/record/check-verify", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const { fullCode } = (kctx.request.body ?? {}) as { fullCode?: string };
			if (!fullCode) {
				kctx.status = 400;
				kctx.body = { error: "missing fullCode" };
				return;
			}
			kctx.body = verifyService.checkVerify(String(fullCode));
		});

		ctx.server.post("/starfx/api/record/add-group", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const { token, groupId } = (kctx.request.body ?? {}) as {
				token?: string;
				groupId?: string;
			};
			if (!token || !groupId) {
				kctx.status = 400;
				kctx.body = { error: "missing token or groupId" };
				return;
			}
			kctx.body = await verifyService.addGroup(String(token), String(groupId));
		});

		ctx.server.post("/starfx/api/record/revoke-token", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const { token } = (kctx.request.body ?? {}) as { token?: string };
			if (!token) {
				kctx.status = 400;
				kctx.body = { error: "missing token" };
				return;
			}
			kctx.body = verifyService.revokeToken(String(token));
		});

		ctx.server.post("/starfx/api/record/list-users", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const { token } = (kctx.request.body ?? {}) as { token?: string };
			const role = verifyService.getRoleByToken(String(token ?? ""));
			if (role !== "owner") {
				kctx.status = 403;
				kctx.body = { error: "权限不足" };
				return;
			}
			kctx.body = verifyService.listUsersByToken(String(token));
		});

		ctx.server.post("/starfx/api/record/set-role", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const {
				token,
				targetQqId,
				role: newRole,
			} = (kctx.request.body ?? {}) as {
				token?: string;
				targetQqId?: string;
				role?: string;
			};
			const opRole = verifyService.getRoleByToken(String(token ?? ""));
			if (opRole !== "owner") {
				kctx.status = 403;
				kctx.body = { error: "权限不足" };
				return;
			}
			kctx.body = verifyService.setRoleByToken(
				String(token),
				String(targetQqId),
				newRole ?? "",
			);
		});

		ctx.server.post("/starfx/api/record/delete-user", async (kctx: KoaCtx) => {
			if (!secretGuard(kctx)) return;
			const { token, targetQqId } = (kctx.request.body ?? {}) as {
				token?: string;
				targetQqId?: string;
			};
			const opRole = verifyService.getRoleByToken(String(token ?? ""));
			if (opRole !== "owner") {
				kctx.status = 403;
				kctx.body = { error: "权限不足" };
				return;
			}
			kctx.body = verifyService.deleteUserByToken(
				String(token),
				String(targetQqId),
			);
		});
	}

	ctx.command("语录.验证 <code>").action(async ({ session }, code) => {
		const error = await verifyService.verifyCommand(
			session.userId,
			session.platform,
			code,
		);
		if (error) return error;
		return "验证成功！回到网页等待自动跳转即可";
	});

	ctx.command("语录.重置").action(async ({ session }) => {
		return verifyService.resetByQqId(session.userId).message;
	});

	ctx.command("语录.删除群 <group>").action(async ({ session }, groupId) => {
		const r = await verifyService.removeGroup(
			session.userId,
			session.platform,
			groupId,
		);
		return r.message;
	});

	ctx
		.command("语录.设权限 <qqId> <role>")
		.action(async ({ session }, qqId, role) => {
			if (role !== "user" && role !== "admin" && role !== "owner") {
				return "角色只能是 user、admin 或 owner";
			}
			return verifyService.setRole(
				session.userId,
				qqId,
				role as "user" | "admin" | "owner",
			).message;
		});

	ctx.command("语录.用户列表").action(async ({ session }) => {
		const r = verifyService.listUsers(session.userId);
		if (!r.success) return r.message;
		return (
			r.users?.map((u) => `${u.username}(${u.qqId}) - ${u.role}`).join("\n") ||
			"暂无用户"
		);
	});

	ctx.command("语录.删除用户 <qqId>").action(async ({ session }, qqId) => {
		return verifyService.deleteUser(session.userId, qqId).message;
	});
}
