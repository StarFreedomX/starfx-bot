import {Context, h, Logger, Random, Schema} from 'koishi'
import * as fs from 'fs'
import * as utils from './utils'
import {safeQuote} from "./utils";

export const name = 'starfx-bot'
export let baseDir: string;
export let assetsDir: string;
export const starfxLogger: Logger = new Logger('starfx-bot')

//复读共享上下文
export const repeatContextMap = new Map<string, [string, number]>();

interface sendLocalImageConfigItem{
  imgPath: string,
}

interface sendLocalImageConfigDict{
  [key: string]: sendLocalImageConfigItem,
}

export interface Config {
  //绘图
  openLock: boolean,
  openSold: boolean,
  bangdreamBorder: boolean,

  //语录
  record: boolean,
  tagWeight: number,
  saveArchive: boolean,

  //指令小功能
  roll: boolean,
  undo: boolean,
  echo: boolean,
  echoBanner: string[],

  //回应
  atNotSay: boolean,
  atNotSayProperty: number,
  atNotSayOther: boolean,
  atNotSayOtherProperty: number,
  iLoveYou: boolean,
  replyBot: string,
  sendLocalImage: sendLocalImageConfigDict,

  //复读
  openRepeat: boolean,
  minRepeatTimes: number,
  repeatPossibility: number,

  //自用功能
  originImg: boolean,
  originImgRSSUrl: string,
  proxyUrl: string,

  //功能控制
  featureControl: string,
}

export const Config = Schema.intersect([
  Schema.object({
    openLock: Schema.boolean().default(true).description('开启明日方舟封印功能'),
    openSold: Schema.boolean().default(true).description('开启闲鱼"卖掉了"功能'),
    bangdreamBorder: Schema.boolean().default(true).description('开启BanG Dream!边框功能'),
  }).description('绘图功能'),
  Schema.object({
    record: Schema.boolean().default(true).description('开启群语录功能'),
    tagWeight: Schema.number().default(5).min(1).description('tag匹配时的权重，越高权重越大'),
    saveArchive: Schema.boolean().default(false).description('开启入典功能').hidden(),
  }).description('语录记录功能'),
  Schema.object({
    roll: Schema.boolean().default(true).description('开启roll随机数功能'),
    undo: Schema.boolean().default(true).description('机器人撤回消息功能(只测试了qq的onebot适配器)'),
    echo: Schema.boolean().default(true).description('echo回声洞功能'),
    echoBanner: Schema.array(String).role('table').description('echo屏蔽词，对文本生效'),
  }).description('指令小功能'),
  Schema.object({
    atNotSay: Schema.boolean().default(true).description('开启‘艾特我又不说话’功能'),
    atNotSayProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特我又不说话'回复概率"),
    atNotSayOther: Schema.boolean().default(true).description('开启‘艾特他又不说话’功能'),
    atNotSayOtherProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特他又不说话'回复概率"),
    iLoveYou: Schema.boolean().default(true).description('开启‘我喜欢你’功能'),
    replyBot: Schema.union(['关闭', '无需at', '必须at']).default('无需at').description('回复‘我才不是机器人！’功能'),
  }).description('特定回应功能'),
  Schema.object({
    sendLocalImage: Schema.dict(Schema.object({
      white: Schema.string(),
      black: Schema.string(),
      imgPath: Schema.string(),
    })).role('table').description("特定指令发送本地图片功能，其中键是指令名称，black/white是黑白名单(直接输入群号用半角逗号分隔，两个都不输入默认全量)，imgPath是图片文件的绝对路径"),
  }),
  Schema.object({
    openRepeat: Schema.boolean().default(true).description('开启复读功能'),
    minRepeatTimes: Schema.number().default(2).description('最少重复次数'),
    repeatPossibility: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.3).description('复读发生概率'),
  }).description('复读功能'),
  Schema.object({
    originImg: Schema.boolean().default(false).description('根据链接获取原图开关'),

  }).description('自用功能'),
  Schema.union([
    Schema.object({
      originImg: Schema.const(true).required(),
      originImgRSSUrl: Schema.string().required().description('推特列表rss地址'),
      proxyUrl: Schema.string().default('http://127.0.0.1:7890').description('代理地址'),
    }),
    Schema.object({}),
  ]),
  Schema.object({
    featureControl: Schema.string().role('textarea', {rows: [15]}).default('{\n\n}')
      .description(`黑/白名单配置，语法为JSON格式(可以不缩进)，<br\>
可配置功能键及语法详见 [项目地址](https://github.com/StarFreedomX/starfx-bot)或[npm发布页](https://www.npmjs.com/package/koishi-plugin-bangdream-ccg)`),
  }).description('高级配置')
])

export const usage =
  `<h2>StarFreedomX的自用插件 放了一些小功能</h2>
  `

export function apply(ctx: Context, cfg: Config) {

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));

  baseDir = ctx.baseDir;
  assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
  //init
  initAssets();
  // write your plugin here

  const controlJson = utils.parseJsonControl(cfg.featureControl)

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        if (utils.detectControl(controlJson, session.guildId, "lock"))
          await session.send(await utils.drawLock(ctx, await utils.getImageSrc(session, param)));
      })
  }
  if (cfg.openSold) {
    ctx.command('卖掉了 [param]')
      .action(async ({session}, param) => {
        //console.log('ssssss')
        if (utils.detectControl(controlJson, session.guildId, "sold"))
          await session.send(await utils.drawSold(ctx, await utils.getImageSrc(session, param)));
      })
  }

  if (cfg.roll) {
    ctx.command('roll')
      .action(async ({session}) => {
        if (utils.detectControl(controlJson, session.guildId, "roll")) {
          return utils.handleRoll(session)
        }
      })
  }

  if (cfg.echo) {
    ctx.command('echo <params>')
      .action(async ({session}, params) => {
        if (utils.detectControl(controlJson, session.guildId, "echo")) {
          const elements = session.elements;
          try {
            //console.log(elements);
            //第一个肯定是指令(其实可能是at)
            while (elements[0].type === 'at' || (elements[0].type === 'text' && !elements[0].attrs?.content.trim())) elements.shift();
            elements[0].attrs.content = elements[0].attrs?.content.trim().split(" ").slice(1).join(" ");
            //console.log(elements);
            //如果什么内容都没有
            if (elements.length == 1 && !elements[0].attrs.content?.length) {
              if (cfg.echoBanner?.some(banText => session.quote?.content?.includes(banText)))return '包含屏蔽词，打断echo';
              return session.quote?.elements;
            }
            if (cfg.echoBanner?.some(banText => session.content?.includes(banText)))return '包含屏蔽词，打断echo';
            return elements;
          } catch (e) {
            return params;
          }
        }
      })
  }

  if (cfg.bangdreamBorder) {
    ctx.command('bdbd [param]')
      .option('starNum', '-n <starNum: number>')
      .option('color', '-c <color: string>')
      .option('train', '-t <train: string>')
      .option('band', '-b <band: string>')
      .action(async ({session, options}, param) => {
        if (utils.detectControl(controlJson, session.guildId, "bdbd")) {
          const drawConfig = await utils.handleBanGDreamConfig(options);
          const imgSrc = await utils.getImageSrc(session, param);
          if (!imgSrc?.length) return '输入无效';
          const imageBase64: string = await utils.drawBanGDream(imgSrc, drawConfig);
          if (!imageBase64?.length) return '输入无效';
          await session.send(h.image(imageBase64))
        }
      })
  }

  if (cfg.record) {
    ctx.command('投稿 [param]')
      .action(async ({session}, param) => {
        if (utils.detectControl(controlJson, session.guildId, "record")) {
          const imageSrc = await utils.getImageSrc(session, param,
            {
              img: true,
              at: false,
              quote: true,
              noParam: false,
              number: false
            });
          if (!imageSrc) {
            return '请发送带图片的指令消息或引用图片消息进行投稿'
          }
          return await utils.addRecord(ctx, session.gid.replace(':', '_'), imageSrc);
        }
      })
    ctx.command('语录 [tag:string]')
      .action(async ({session}, tag) => {
        if (utils.detectControl(controlJson, session.guildId, "record")) {
          const filepath = await utils.getRecord(cfg, session.gid.replace(':', '_'), tag);
          starfxLogger.info(`send record: ${filepath}`);
          if (!filepath) return '暂无语录呢';
          await session.send(h.image(filepath));
        }
      });
  }

  for(const key in cfg.sendLocalImage){
    ctx.command(key)
      .action(async ({session}) => {
        if (utils.detectControl(controlJson, session.guildId, "sendLocalImage") &&
          utils.detectControl(controlJson, session.guildId, key)
        )
        return h.image(utils.safeQuote(cfg.sendLocalImage[key].imgPath, false))
    })
  }


  if (cfg.saveArchive) {
    ctx.command('入典')
      .action(async ({session}) => {
        if (!session.quote) return '请引用合并转发聊天记录进行入典';
      })
  }

  if (cfg.undo) {
    ctx.command('undo')
      .alias('撤回')
      .action(async ({session}) => {
        if (utils.detectControl(controlJson, session.guildId, "undo"))
          await utils.undo(cfg, session);
      })
  }

  if (cfg.originImg) {
    ctx.command('获取X原图 <urls>')
      .alias('推特原图')
      .action(async ({session}, urls) => {
        if (utils.detectControl(controlJson, session.guildId, "originImg")) {
          let [xUrls, xIndex] = await Promise.all([
            utils.getXUrl(session?.quote?.content),
            utils.getXNum(session)
          ]);
          xIndex = xIndex.length ? xIndex : xUrls.map((_, i) => i);
          //console.log(`xIndex:${xIndex}`);
          //console.log(`xUrls:${xUrls}`);
          const filteredUrls = xIndex.filter(i => i >= 0 && i < xUrls.length).map(i => xUrls[i]);
          //console.log(filteredUrls)
          const imageUrls = await utils.getXImage(cfg.originImgRSSUrl, filteredUrls);
          //console.log(imageUrls);
          await utils.sendImages(session, cfg, imageUrls);
        }
      })
  }

  ctx.middleware(async (session, next) => {
    const elements = session.elements;
    if (cfg.openRepeat && utils.detectControl(controlJson, session.guildId, "repeat")) {
      const content = session.content;//获取消息内容
      const ctxArr = repeatContextMap.get(session.gid);//获取上下文中存储的对话内容及次数
      if (!ctxArr || ctxArr[0] !== content) {//不存在上下文或两次消息不同
        //初始化/重置 存储到上下文中
        repeatContextMap.set(session.gid, [content, 1]);
      } else {//两次消息相同
        //times不为-1且times自加1之后大于设定的最小幅度次数
        //执行概率为repeatPossibility的随机布尔值
        if (ctxArr[1] !== -1 && ++ctxArr[1] >= cfg.minRepeatTimes && Random.bool(cfg.repeatPossibility)) {
          //times置为-1防止重复复读
          ctxArr[1] = -1;
          await session.send(content);//复读
        }
      }
    }

    if (utils.detectControl(controlJson, session.guildId, "atNotSay"))
      await utils.atNotSayReply(cfg, session, elements);
    if (utils.detectControl(controlJson, session.guildId, "replyBot"))
      await utils.replyBot(cfg, session, elements);
    if (utils.detectControl(controlJson, session.guildId, "iLoveYou"))
      await utils.iLoveYou(cfg, session, elements);
    return next();
  });

  if (process.env.NODE_ENV === 'development') {
    ctx.command('test')
      .action(async ({session}) => {

      })
  }

  function initAssets() {
    const fromUrl = `${__dirname}/../assets`;
    assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
    if (!fs.existsSync(fromUrl)) return;
    if (!fs.readdirSync(fromUrl)?.length) return;
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, {recursive: true});
    }

    fs.cpSync(fromUrl, assetsDir, {recursive: true, force: true});
    if (process.env.NODE_ENV !== "development") {
      fs.rmSync(fromUrl, {recursive: true});
    }

  }
}

