import { Context } from "koishi";
import path from "node:path";
import fs from "node:fs";
import ejs from 'ejs';
import * as crypto from 'crypto';

declare module "@koishijs/cache" {
    interface Tables {
        // 动态表名：包含房间号
        // 这里我们将 Value 定义为 Song[]，因为 KTV 是一个歌曲列表
        ktv_room: Song[];
    }
}

interface Song {
    id: string
    title: string
    url: string
}

interface OpLog {
    idArray: string[]
    hash: string
    song: Song
    toIndex: number
    timestamp: number
}

export function runKTVServer(ctx: Context, assetsDir: string) {
    // 预读模板文件
    const templatePath = path.resolve(assetsDir,'./songRoom.ejs')
    let templateStr = fs.readFileSync(templatePath, 'utf-8')

    // 严格校验 roomId
    const ROOM_ID_REGEX = /^[a-zA-Z0-9_-]{1,20}$/;
    const CACHE_EXPIRE_TIME = 24 * 60 * 60 * 1000;

    // 缓存变量，按 roomId 分隔
    const roomOpCache: Record<string, OpLog[]> = {}
    const roomSongsCache: Record<string, Song[]> = {}

    // 生成哈希工具函数
    function getHash(songs: Song[]) {
        if (!songs || songs.length === 0) return "EMPTY_LIST_HASH"; // 给空列表一个固定标识
        const str = songs.map(s => `${s.id}:${s.title}:${s.url}`).join('|');
        return crypto.createHash('md5').update(str).digest('hex');
    }

    // 每 5 分钟检测并清理 5 分钟前的缓存
    ctx.setInterval(() => {
        const now = Date.now();
        for (const roomId in roomOpCache) {
            roomOpCache[roomId] = roomOpCache[roomId].filter(log => now - log.timestamp < 5 * 60 * 1000);
            if (!roomOpCache[roomId]?.length) {
                delete roomOpCache[roomId];
                delete roomSongsCache[roomId];
            }
        }
    }, 5 * 60 * 1000);


    // 获取歌曲列表及当前哈希
    ctx.server.get('/songRoom/api/songListInfo', async (koaCtx) => {
        const { roomId: roomIds, lastHash: clientHashs } = koaCtx.query;
        const roomId = Array.isArray(roomIds) ? roomIds.at(0) : roomIds;
        const clientHash = Array.isArray(clientHashs) ? clientHashs.at(0) : clientHashs;
        // 初始化歌曲缓存 (确保不是 undefined)
        if (!roomSongsCache[roomId]) {
            const dbData = await ctx.cache.get("ktv_room", roomId);
            roomSongsCache[roomId] = dbData || [];
        }

        const currentSongs = roomSongsCache[roomId];
        const serverHash = getHash(currentSongs);

        // 初始化 OpLog 缓存 (重要：空列表也需要一个基础 Log 作为操作起点)
        if (!roomOpCache[roomId] || roomOpCache[roomId].length === 0) {
            roomOpCache[roomId] = [{
                idArray: currentSongs.map(s => s.id),
                hash: serverHash,
                song: null,
                toIndex: -1,
                timestamp: Date.now()
            }];
        }

        // clientHash 为空或不匹配时 下发全量
        if (clientHash && clientHash === serverHash) {
            return koaCtx.body = { changed: false, hash: serverHash };
        }

        koaCtx.body = {
            changed: true,
            list: currentSongs,
            hash: serverHash
        };
    });

    // Move/Add/Delete 逻辑
    ctx.server.post('/songRoom/api/songOperation', async (koaCtx) => {
        const { roomId: roomIds} = koaCtx.query;
        const roomId = Array.isArray(roomIds) ? roomIds.at(0) : roomIds;
        if (!ROOM_ID_REGEX.test(roomId)) {
            return koaCtx.body = { success: false, msg: 'Invalid Room ID' };
        }
        const body = koaCtx.request["body"];
        const { idArrayHash, song, toIndex } = body;

        if (song && song.url && song.url.includes('b23.tv')) {
            const bvid = await resolveBilibiliBV(song.url);
            if (bvid) {
                // 将 url 替换为提取出的 BV 号（或者完整的 bilibili:// 协议）
                // 这样存入缓存和下发给其他客户端时，就是最纯净的数据
                song.url = `bilibili://video/${bvid}`;
                // 如果你的 song 对象里有 id 字段，通常建议保持一致
                if (!song.id) song.id = bvid;
            }
        }

        // 确保缓存存在，防止服务器重启后第一个请求是 POST 导致报错
        if (!roomSongsCache[roomId]) {
            roomSongsCache[roomId] = (await ctx.cache.get("ktv_room", roomId) || []);
        }

        // 如果 OpLog 丢了，手动补一个基于当前内存状态的底座
        if (!roomOpCache[roomId]) {
            roomOpCache[roomId] = [{
                idArray: roomSongsCache[roomId].map(s => s.id),
                hash: getHash(roomSongsCache[roomId]),
                song: null,
                toIndex: -1,
                timestamp: Date.now()
            }];
        }

        const logs = roomOpCache[roomId];
        console.log([...logs].reverse())
        const hitIdx = [...logs].reverse().findIndex(l => l.hash === idArrayHash);
        // console.log(hitIdx)

        // REJECT 逻辑：如果前端传来的 Hash 在日志里找不到
        // 可能是因为服务器重启导致 Log 丢失，或者前端落后太多
        if (hitIdx === -1) {
            return koaCtx.body = { success: false, code: 'REJECT' };
        }

        const baseLog = logs[hitIdx];
        const spotIds = [...baseLog.idArray];
        const nowSongs = [...roomSongsCache[roomId]]; // 浅拷贝一份防止污染

        const currentOp = {
            idArray: [],
            hash: '',
            song: song,
            toIndex: toIndex,
            timestamp: Date.now()
        };

        const laterOps = [...logs.slice(hitIdx + 1), currentOp];

        try {
            // 执行重演逻辑
            const finalSongs = songOperation(nowSongs, spotIds, laterOps);
            const finalIds = finalSongs.map(s => s.id);
            const finalHash = getHash(finalSongs);

            currentOp.idArray = finalIds;
            currentOp.hash = finalHash;
            logs.push(currentOp);

            // 保持日志长度，防止内存溢出（只保留最近 50 条操作记录）
            if (logs.length > 50) logs.shift();

            roomSongsCache[roomId] = finalSongs;
            await ctx.cache.set(`ktv_room`, roomId, finalSongs, CACHE_EXPIRE_TIME);

            koaCtx.body = { success: true, hash: finalHash, song };
        } catch (e) {
            console.error("Operation re-run failed:", e);
            koaCtx.body = { success: false, code: 'REJECT' };
        }
    });

    /**
     * 解析 B23.TV 短链接并提取 BV 号
     * @param {string} inputUrl
     * @returns {Promise<string|null>} 返回提取到的 BV 号
     */
    async function resolveBilibiliBV(inputUrl: string): Promise<string> {
        // 基础校验：必须是 b23.tv 的链接
        if (!inputUrl.includes('b23.tv')) {
            // 如果输入已经是原始链接，直接尝试从输入提取
            return extractBV(inputUrl);
        }
        try {
            // 发起请求，禁止自动重定向
            const response = await ctx.http(inputUrl, {
                redirect: 'manual',
                validateStatus: (status) => status >= 200 && status < 400,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/004.1'
                }
            });

            let targetUrl = response?.headers?.get('location');

            return extractBV(targetUrl);

        } catch (error) {
            // 处理 axios 在 302 时可能抛出的异常
            const loc = error.response?.headers?.location;
            if (loc) return extractBV(loc);

            console.error('解析 B23 短链接失败:', error.message);
            return null;
        }
    }

    /**
     * 正则提取 BV 号
     */
    function extractBV(url: string) {
        if (!url) return null;
        const match = url.match(/(BV[a-zA-Z0-9]{10})/);
        return match ? match[0] : null;
    }

    function songOperation(nowSongs: Song[], songIdArray: string[], ops: OpLog[]): Song[] {
        /*
        实现逻辑：首先构造双向链表
        HEAD <-> 0 <-> A <-> 1 <-> B <-> 2 <-> C <-> 3 <-> D <-> 4 <-> E <-> 5 <-> F <-> 6 <-> G <-> 7 <-> TAIL
        对于接下来的Ops采用双向链表操作实现
        op1: A -> 4
        op2: B -> 6
        ...
        那么将很简单，让 A 的前后元素相连变为 0 <-> 1
        然后把prev(4) <-> 4 改为 prev(4) <-> A <-> 4 ......
        以此类推
         */
        // 构建最新的 Song 状态池
        const latestSongMap = new Map<string, Song>();

        // 初始数据判空
        if (Array.isArray(nowSongs)) {
            nowSongs.forEach(s => s && s.id && latestSongMap.set(s.id, s));
        }

        // 更新状态池，增加 op 和 song 的安全校验
        [...ops].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .forEach(op => {
                if (op?.song?.id && op.toIndex !== -1) {
                    latestSongMap.set(op.song.id, op.song);
                }
            });

        //双向链表处理
        class ListNode {
            val: string | number;
            prev: ListNode | null = null;
            next: ListNode | null = null;
            constructor(val: string | number) { this.val = val; }
        }

        const head = new ListNode('HEAD');
        let current = head;
        const idNodes = new Map<string, ListNode>();
        const anchorNodes = new Map<number, ListNode>();

        // 初始化链表：这里是受控循环，结构是稳定的
        for (let i = 0; i <= (songIdArray?.length || 0); i++) {
            const anchorNode = new ListNode(i);
            anchorNodes.set(i, anchorNode);

            current.next = anchorNode;
            anchorNode.prev = current;
            current = anchorNode;

            if (i < songIdArray.length) {
                const id = songIdArray[i];
                if (id !== undefined && id !== null) {
                    const idNode = new ListNode(id);
                    idNodes.set(id, idNode);
                    current.next = idNode;
                    idNode.prev = current;
                    current = idNode;
                }
            }
        }

        // 执行逻辑
        ops.forEach(op => {
            if (!op?.song?.id) return;
            const { song, toIndex } = op;
            let node = idNodes.get(song.id);

            // 1. 安全断开旧连接
            if (node && node.prev) {
                const prevNode = node.prev;
                const nextNode = node.next;
                prevNode.next = nextNode;
                if (nextNode) {
                    nextNode.prev = prevNode;
                }
                node.prev = null;
                node.next = null;
            }

            // 2. 删除操作
            if (toIndex === -1) {
                idNodes.delete(song.id);
                return;
            }

            // 创建/重用节点
            if (!node) {
                node = new ListNode(song.id);
                idNodes.set(song.id, node);
            }

            // 安全挂载到锚点
            const targetAnchor = anchorNodes.get(toIndex);
            // 必须确保 targetAnchor 存在，且由于 HEAD 的存在，targetAnchor.prev 理论上不为空
            if (targetAnchor && targetAnchor.prev) {

                const before = targetAnchor.prev;

                before.next = node;
                node.prev = before;

                node.next = targetAnchor;
                targetAnchor.prev = node;
            }
        });

        // 转换回数组
        const result: Song[] = [];
        let p: ListNode | null = head.next;

        while (p !== null) {
            if (typeof p.val === 'string' && p.val !== 'HEAD') {
                const songData = latestSongMap.get(p.val);
                if (songData) {
                    result.push(songData);
                }
            }
            p = p.next;
        }

        return result;
    }

    // WebUI 托管
    // 访问地址示例：http://localhost:5140/songRoom/12345
    ctx.server.get('/songRoom/:roomId', async (koaCtx) => {
        if (process.env.NODE_ENV === "development") {
            console.log('loading template')
            const templatePath = path.resolve(__dirname, '../../assets/songRoom.ejs')
            templateStr = fs.readFileSync(templatePath, 'utf-8')
        }
        const { roomId } = koaCtx.params
        const urlPath = koaCtx.path;
        // 检查路径末尾是否有斜杠
        if (urlPath.endsWith('/')) {
            koaCtx.status = 301;
            // 加上斜杠并保留 query 参数（如 ?from=xxx）
            koaCtx.redirect(urlPath.slice(0,-1) + koaCtx.search);
            return;
        }
        // 使用 EJS 渲染，并传入变量
        const html = ejs.render(templateStr, {
            roomId,
            pageTitle: `KTV 房间 - ${roomId}`
        })
        koaCtx.type = 'html'
        koaCtx.body = html
    })

    // 默认入口页面：输入房间号
    ctx.server.get('/songRoom', async (koaCtx) => {
        koaCtx.type = 'html';
        const urlPath = koaCtx.path;
        // 检查路径末尾是否有斜杠
        if (!urlPath.endsWith('/')) {
            koaCtx.status = 301;
            // 加上斜杠并保留 query 参数（如 ?from=xxx）
            koaCtx.redirect(urlPath + '/' + koaCtx.search);
            return;
        }
        koaCtx.body = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>进入 KTV 房间</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
            @keyframes slideUp {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
            .animate-pop { animation: slideUp 0.5s ease-out; }
        </style>
    </head>
    <body class="bg-slate-50 min-h-screen flex items-center justify-center p-6 text-slate-900">
        <div class="w-full max-w-sm bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 animate-pop">
            <header class="text-center mb-8">
                <h1 class="text-4xl font-black text-indigo-600 mb-2">KTV Queue</h1>
                <p class="text-slate-400 font-medium">输入房间号进入房间</p>
            </header>

            <div class="space-y-4">
                <input id="roomInput" type="text" maxlength="10"
                    class="w-full px-6 py-4 bg-slate-50 rounded-2xl text-center text-2xl font-bold tracking-widest outline-none focus:ring-4 focus:ring-indigo-100 transition-all border-2 border-transparent focus:border-indigo-400"
                    placeholder="0000" autofocus>

                <button onclick="joinRoom()"
                    class="w-full py-4 bg-indigo-600 text-white text-lg font-bold rounded-2xl hover:bg-indigo-700 active:scale-95 transition-all shadow-lg shadow-indigo-100">
                    进入房间
                </button>
            </div>

            <p class="text-center text-slate-300 text-xs mt-8 uppercase tracking-widest font-bold">Powered by StarFreedomX</p>
        </div>

        <script>
            function joinRoom() {
                const id = document.getElementById('roomInput').value.trim();
                if (id) window.location.href = id;
            }

            // 支持回车键跳转
            document.getElementById('roomInput').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') joinRoom();
            });
        </script>
    </body>
    </html>
    `;
    });

    /*// 这段代码必须放在所有 ctx.server.get/post 逻辑的最下方
    ctx.server.all('/songRoom/(.*)', async (koaCtx, next) => {
        // 如果执行到了这里，说明前面的路由（如 /songRoom/:roomId）都没匹配上
        // 直接返回 404 错误，不调用 next()
        koaCtx.status = 404;
        koaCtx.body = '404 Not Found - 路径错误';
        // 不调用 next()，Koishi 的控制台逻辑就不会被触发
    });*/


}
