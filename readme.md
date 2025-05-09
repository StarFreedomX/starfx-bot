# koishi-plugin-starfx-bot

[![npm](https://img.shields.io/npm/v/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot) [![npm](https://img.shields.io/npm/l/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot) [![npm](https://img.shields.io/npm/dt/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot)

StarFreedomX机器人的小功能，自用

## 已加入的功能列表：

* 明日方舟封印功能
* 闲鱼“卖掉了”功能
* 艾特我/他又不说话
* 我才不是机器人！
* 我也喜欢你！
* BanG Dream!边框绘制
* 群语录
* 复读

## List to Do

* 为每种功能添加单独的群聊控制开关
* 修改BanG Dream!边框的绘制为使用sharp，加快速度
* 增加入典功能


## 🔧 功能权限控制（可选）

本插件支持为各个功能设置 **群聊白名单 / 黑名单**，用于控制不同功能在指定群聊中是否启用。

配置格式为 JSON


- `whitelist: true`：启用白名单模式，仅允许列出的群使用该功能
- `whitelist: false`：启用黑名单模式，禁止列出的群使用该功能
- `groups`：群号数组，必须为数字

若未配置某功能项，则默认所有群均可使用。

---

### 📌 可配置功能键一览

| 键名         | 功能说明                                   |
|------------|----------------------------------------|
| `lock`     | 明日方舟封印功能（对应 `openLock`）                |
| `sold`     | 闲鱼“卖掉了”功能（对应 `openSold`）               |
| `repeat`   | 群复读功能（对应 `openRepeat`）                 |
| `record`   | 群语录功能（对应 `投稿、语录`）                      |
| `atNotSay` | “艾特我/他又不说话”系列功能                        |
| `replyBot` | “我才不是机器人！”系列功能                         |
| `iLoveYou` | “我也喜欢你”系列功能                            |
| `bdbd`     | BanG Dream! 边框功能（对应 `bangdreamBorder`） |
| `roll`     | 随机数功能                                  |
| `undo`     | 撤回功能                                   |
| `echo`     | echo功能                                 |

---

### 🧪 示例：仅允许特定群使用 `roll`，禁止某群使用 `sold`

```json
{
  "roll": {
    "whitelist": true,
    "groups": [123456789,114514191]
  },
  "sold": {
    "whitelist": false,
    "groups": [987654321]
  }
}
```

## 更新日志
| 版本         | 更新日志                          |
|------------|-------------------------------|
| `0.0.1`    | 加入封印功能                        |
| `0.1.0`    | 加入"卖掉了"功能                     |
| `0.2.0`    | 加入"艾特我又不说话"回复功能               |
| `0.3.0`    | 加入"我喜欢你"和"我才不是机器人！"回复功能       |
| `0.4.0`    | 更改处理库为sharp                   |
| `0.5.0`    | 加入BanG Dream!边框功能             |
| `0.6.0`    | 加入群语录功能，修复一处bangdream绘制的bug   |
| `0.7.0`    | 加入复读功能                        |
| `0.8.0`    | 将各个工具函数封装在utils.ts中，更改语录的触发方式 |
| `0.9.0`    | 添加白名单/黑名单模式，对每个功能做过滤          |
| `0.10.0`   | 添加随机数功能                       |
| `0.10.1`   | 修复随机数骰子功能输入负数报错的bug           |
| `0.10.2`   | 增加roll功能的人称变化                 |
| `0.11.0`   | 增加适配于onebot（主要是qq）的撤回功能       |
| `0.11.1`   | 修复bdbd传参错误问题                  |
| `0.11.2`   | 优化消息捕获图片逻辑                    |
| `0.12.0`   | 加入echo功能                      |
