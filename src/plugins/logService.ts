import fs from "node:fs";
import path from "node:path";

let logDir = "";
let todayFile = "";

function ensureDir() {
	if (!fs.existsSync(logDir)) {
		fs.mkdirSync(logDir, { recursive: true });
	}
}

function today() {
	const d = new Date();
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, "0");
	const day = String(d.getDate()).padStart(2, "0");
	return `${y}-${m}-${day}`;
}

function timestamp() {
	const d = new Date();
	const h = String(d.getHours()).padStart(2, "0");
	const m = String(d.getMinutes()).padStart(2, "0");
	const s = String(d.getSeconds()).padStart(2, "0");
	return `${today()} ${h}:${m}:${s}`;
}

export function initLog(baseDir: string) {
	logDir = path.join(baseDir, "data/starfx-bot/logs");
	ensureDir();
	todayFile = path.join(logDir, `record-${today()}.log`);
	ensureFile();
}

function ensureFile() {
	const f = path.join(logDir, `record-${today()}.log`);
	if (f !== todayFile) {
		todayFile = f;
	}
	if (!fs.existsSync(todayFile)) {
		fs.writeFileSync(todayFile, "", "utf8");
	}
}

function write(level: string, msg: string) {
	ensureFile();
	const line = `[${timestamp()}] [${level}] ${msg}\n`;
	fs.appendFileSync(todayFile, line, "utf8");
	console.log(`[log] ${line.trim()}`);
}

export function info(msg: string) {
	write("INFO", msg);
}

export function warn(msg: string) {
	write("WARN", msg);
}

export function error(msg: string) {
	write("ERROR", msg);
}

/** 读取最近 N 天的日志，聚合返回 */
export function readRecent(days: number = 7): string {
	ensureDir();
	const files = fs
		.readdirSync(logDir)
		.filter((f) => f.startsWith("record-") && f.endsWith(".log"))
		.sort()
		.reverse()
		.slice(0, days);

	const lines: string[] = [];
	for (const f of files.reverse()) {
		const content = fs.readFileSync(path.join(logDir, f), "utf8");
		lines.push(...content.trim().split("\n").filter(Boolean));
	}
	return lines.join("\n");
}
