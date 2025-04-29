import {Context, h, Logger, Random, Schema} from 'koishi'
import * as fs from 'fs'
import * as utils from './utils'

export const name = 'starfx-bot'
export let baseDir: string;
export let assetsDir: string;
export const starfxLogger: Logger = new Logger('starfx-bot')

//复读共享上下文
export const repeatContextMap = new Map<string, [string, number]>();

export interface Config {
  openLock: boolean,
  openSold: boolean,
  bangdreamBorder: boolean,
  atNotSay: boolean,
  atNotSayOther: boolean,
  atNotSayProperty: number,
  atNotSayOtherProperty: number,
  record: boolean,
  openRepeat: boolean,
  minRepeatTimes: number,
  repeatPossibility: number,
  saveArchive: boolean,
  replyBot: string,
  iLoveYou: boolean,
}

export const Config = Schema.intersect([
  Schema.object({
    openLock: Schema.boolean().default(true).description('开启明日方舟封印功能'),
    openSold: Schema.boolean().default(true).description('开启闲鱼"卖掉了"功能'),
    bangdreamBorder: Schema.boolean().default(true).description('开启BanG Dream!边框功能'),
    record: Schema.boolean().default(true).description('开启群语录功能'),
    saveArchive: Schema.boolean().default(false).description('开启入典功能').hidden(),
    atNotSay: Schema.boolean().default(true).description('开启‘艾特我又不说话’功能'),
    atNotSayProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特我又不说话'回复概率"),
    atNotSayOther: Schema.boolean().default(true).description('开启‘艾特他又不说话’功能'),
    atNotSayOtherProperty: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.5).description("'艾特他又不说话'回复概率"),
    openRepeat: Schema.boolean().default(true).description('开启复读功能'),
    minRepeatTimes: Schema.number().default(2).description('最少重复次数'),
    repeatPossibility: Schema.number().role('slider')
      .min(0).max(1).step(0.01).default(0.3).description('复读发生概率'),
    iLoveYou: Schema.boolean().default(true).description('开启‘我喜欢你’功能'),
    replyBot: Schema.union(['关闭', '无需at', '必须at']).default('无需at').description('回复‘我才不是机器人！’功能'),
  }),
])

export const usage =
  `<h5>StarFreedomX的自用插件 放了一些小功能</h5>
  `

export function apply(ctx: Context, cfg: Config) {

  ctx.i18n.define('zh-CN', require('./locales/zh-CN'));

  baseDir = ctx.baseDir;
  assetsDir = `${ctx.baseDir}/data/starfx-bot/assets`;
  //init
  initAssets();
  // write your plugin here

  if (cfg.openLock) {
    ctx.command('封印 [param]')
      .action(async ({session}, param) => {
        return await utils.drawLock(ctx, await utils.getImageSrc(session, param));
      })
  }
  if (cfg.openSold) {
    ctx.command('卖掉了 [param]')
      .action(async ({session}, param) => {
        return await utils.drawSold(ctx, await utils.getImageSrc(session, param));
      })
  }

  if (cfg.bangdreamBorder) {
    ctx.command('bangdreamborder [param]')
      .alias('bdbd')
      .option('starNum', '-n <starNum: number>')
      .option('color', '-c <color: string>')
      .option('train', '-t <train: string>')
      .option('band', '-b <band: string>')
      .action(async ({session, options}, param) => {
        const p = session.send('图片处理中请稍等...')
        console.log(param)
        const drawConfig = await utils.handleBanGDreamConfig(options);
        const imageBase64: string = await utils.drawBanGDream(await utils.getImageSrc(session, param), drawConfig);
        await p;
        return h.image(imageBase64)
      })
  }

  if (cfg.record) {
    ctx.command('投稿 [param]')
    .action(async ({session}, param) => {
      const imageSrc = await utils.getImageSrc(session, param,
        {
          img: true,
          at: false,
          quote: true,
          noParam: false,
          number: false
        });
      if (!imageSrc) {return '请发送带图片的指令消息或引用图片消息进行投稿'}
      return await utils.addRecord(ctx, session.gid.replace(':', '_'), imageSrc);
      //console.log('oooooo')
      //return h.image('https://bestdori.com/assets/jp/musicjacket/musicjacket600_rip/assets-star-forassetbundle-startapp-musicjacket-musicjacket600-596_sensenfukoku_super-jacket.png')
    })
    ctx.command('语录')
    .action(async ({session}) => {
        const filepath = await utils.getRecord(session.gid.replace(':', '_'));
        starfxLogger.info(`send record: ${filepath}`);
        if (!filepath) return '暂无语录呢';
        return h.image(filepath);
    })
  }

  if (cfg.saveArchive){
    ctx.command('入典 [param]')
      .action(async ({session}, param) => {
        const imageSrc = await utils.getImageSrc(session, param,
          {
            img: true,
            at: false,
            quote: true,
            noParam: false,
            number: false
          });
        if (!imageSrc) {return '请发送带图片的指令消息或引用图片消息进行投稿'}

    })
  }

  ctx.middleware(async (session, next) => {
    const elements = session.elements;
    if(cfg.openRepeat){
      const content = session.content;
      const ctxArr = repeatContextMap.get(session.gid);
      if (!ctxArr || ctxArr[0] !== content) {
        //初始化 存储到上下文中
        repeatContextMap.set(session.gid, [content, 1]);
      }else{
        //here groupMap[0]===content
        if (ctxArr[1] !== -1 && ++ctxArr[1] >= cfg.minRepeatTimes && Random.bool(cfg.repeatPossibility)){
          ctxArr[1] = -1;
          await session.send(content);
        }
      }
    }


    await utils.atNotSayReply(cfg, session, elements);

    await utils.replyBot(cfg, session, elements);

    await utils.iLoveYou(cfg, session, elements);

    return next();
  });

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

