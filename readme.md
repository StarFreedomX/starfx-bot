# koishi-plugin-starfx-bot

[![npm](https://img.shields.io/npm/v/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot) [![npm](https://img.shields.io/npm/l/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot) [![npm](https://img.shields.io/npm/dt/koishi-plugin-starfx-bot?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-starfx-bot)

StarFreedomX机器人的小功能，自用

# 已加入的功能列表：

* 明日方舟封印功能
* 闲鱼“卖掉了”功能
* 艾特我/他又不说话
* 我才不是机器人！
* 我也喜欢你！
* BanG Dream!边框绘制
* 群语录
* 复读

# List to Do

* 为每种功能添加单独的群聊控制开关
* 修改BanG Dream!边框的绘制为使用sharp，加快速度
* 增加入典功能

# 更新日志
| 版本      | 更新日志                          |
|---------|-------------------------------|
| `0.0.1` | 加入封印功能                        |
| `0.1.0` | 加入"卖掉了"功能                     |
| `0.2.0` | 加入"艾特我又不说话"回复功能               |
| `0.3.0` | 加入"我喜欢你"和"我才不是机器人！"回复功能       |
| `0.3.3` | 修订添加"我才不是机器人"是否需要at           |
| `0.3.4` | 分离"艾特我/他又不说话"的两个选项为单独的开关      |
| `0.3.5` | 修复丢失的assets                   |
| `0.3.6` | 添加"艾特我/他又不说话"的概率配置            |
| `0.4.0` | 更改处理库为sharp                   |
| `0.4.1` | 修复sharp处理w>h的图报错的bug          |
| `0.5.0` | 加入BanG Dream!边框功能             |
| `0.5.1` | 对边框的参数做了限定，修复了异常输入导致的报错       |
| `0.6.0` | 加入群语录功能，修复一处bangdream绘制的bug   |
| `0.7.0` | 加入复读功能                        |
| `0.8.0` | 将各个工具函数封装在utils.ts中，更改语录的触发方式 |
