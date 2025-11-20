import {Context, h, Random} from "koishi";
import {assetsDir, baseDir, starfxLogger} from "../index";
import sharp from "sharp";
import {getImageFromUrl} from "../utils";
import {Jimp} from "jimp";

/**
 * 将options的参数转换为drawBanGDreamBorder的配置
 * @param options
 * @return 适用于边框绘制的参数
 */
export async function handleBanGDreamConfig(options) {
  const types = {
    cool: ['cool', 'blue', '蓝', '蓝色'],
    powerful: ['powerful', 'red', '红', '红色'],
    pure: ['pure', 'green', '绿', '绿色'],
    happy: ['happy', 'orange', '橙', '橙色'],
  }
  const bands = {
    ppp: ['ppp', 'poppin\'Party', '破琵琶', '步品破茶', 'poppin', 'popipa', 'poppinparty', 'ポピパ'],
    ag: ['ag', 'afterglow', '夕阳红', '悪蓋愚狼'],
    pp: ['pp', 'pastel＊palettes', 'pastel*palettes', 'pastelPalettes', '怕死怕累', 'pastel', 'palettes', 'pasupare', 'パスパレ', '破巣照破烈斗'],
    hhw: ['hhw', 'ハロー、ハッピーワールド！', 'hello,happyworld!', 'hellohappyworld', 'ハロハピ', 'hello，happyworld！', 'harohapi', '破狼法被威悪怒', '儿歌团', '好好玩'],
    r: ['r', 'roselia', '露世里恶', '萝', '露世裏悪', 'ロゼリア', 'r组', '相声团', '相声组'],
    ras: ['ras', 'raiseasuilen', 'raise', 'suilen', 'ラス', '零図悪酔恋', '睡莲', '麗厨唖睡蓮', '睡蓮'],
    mnk: ['mnk', 'モニカ', '蝶团', '蝶', 'morfonica', '毛二力', 'monika', 'monica'],
    go: ['go', 'mygo!!!!!', 'mygo！！！！！', 'mygo', '我去！！！！！', '我去!!!!!', '我去', '卖狗']
  }
  const trains = {
    'color_star': ['花后', '1', '彩', 'true'],
    'normal_star': ['花前', '0', 'false']
  }
  const drawConfig = {
    color: '',
    band: '',
    starType: '',
    starNum: 0,
    border: '',
  };
  //处理color参数
  if (options?.color) {
    for (const [type, aliases] of Object.entries(types)) {
      if (aliases.includes(options.color.toLowerCase())) {
        drawConfig.color = type;
        break;
      }
    }
  }
  //处理band参数
  if (options?.band) {
    for (const [band, aliases] of Object.entries(bands)) {
      if (aliases.includes(options.band.toLowerCase())) {
        drawConfig.band = band;
        break;
      }
    }
  }
  // 处理 starNum 参数
  const starNum = options?.starNum ? parseInt(options.starNum) : 0;
  drawConfig.starNum =  starNum > 0 && starNum < 10 ? starNum : 0;

  // 处理 starType 参数
  if (options?.train){
    for (const [train, aliases] of Object.entries(trains)) {
      if (aliases.includes(options.train.toLowerCase())) {
        drawConfig.starType = train;
        break;
      }
    }
  }
  return drawConfig;
}

/**
 * "封印"绘图功能
 * @param ctx Context
 * @param baseImage 被封印的图片url
 * @return 画完的图片 h对象
 */
export async function drawLock(ctx: Context, baseImage: string) {
  const image = await getImageFromUrl(ctx, baseImage);
  if (image === -1) {
    return '发生错误'
  } else if (image === -2) {
    return '输入无效'
  }
  const imageMetadata = await image.metadata();
  const lockUrl = `${baseDir}/data/starfx-bot/assets/lock.png`;
  const size1 = Math.min(imageMetadata.width, imageMetadata.height);
  image.resize({width: size1, height: size1, fit: 'cover'})
  const overlay = sharp(lockUrl).png();
  overlay.resize({width: size1});
  image.composite([{input: await overlay.toBuffer()}]);
  return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * "卖掉了"绘图函数
 * @param ctx
 * @param baseImage
 * @return 画完的图片 h对象
 */
export async function drawSold(ctx: Context, baseImage: string) {
  const image = await getImageFromUrl(ctx, baseImage);
  if (image === -1) {
    return '发生错误'
  } else if (image === -2) {
    return '输入无效'
  }
  const imageMetadata = await image.metadata();
  const size1 = Math.min(imageMetadata.width, imageMetadata.height);
  image.resize({width: size1, height: size1, fit: 'cover'})
  const middle = sharp({
    create: {
      width: size1,
      height: size1,
      channels: 4,
      background: {r: 255, g: 255, b: 255, alpha: 0.4},
    }
  }).png();
  const soldUrl = `${assetsDir}/sold.png`;
  const overlay = sharp(soldUrl).png();
  const overlaySize = Math.round(size1 * 182 / 240)
  overlay.resize({
    width: overlaySize,
    height: overlaySize,
  });
  const topLeft = Math.round(overlaySize * 29 / 182)

  image.composite([
    {input: await middle.toBuffer()},
    {
      input: await overlay.toBuffer(),
      top: topLeft,
      left: topLeft,
    }
  ]);
  return h.image(await image.png().toBuffer(), "image/png");
}

/**
 * BanG Dream!边框绘制功能
 * @param avatar 要绘制的底图
 * @param inputOptions 输入参数，接受color band starType starNum border
 */
export async function drawBanGDream(avatar: string, inputOptions?: {
  color: string,
  band: string,
  starType: string,
  starNum: number,
  border: string,
})
{
  if (!avatar) {
    return ''
  }
  const colors = ['cool', 'pure', 'happy', 'powerful'];
  const bands = ['ppp', 'ag', 'pp', 'r', 'hhw', 'ras', 'mnk', 'go'];
  const starTypes = ['normal_star', 'color_star'];
  const starNums = [1, 2, 3, 4, 5];
  //const borders = ['card-1', 'card-2', 'card-3', 'card-4', 'card-5'];
  const options = {
    color: inputOptions.color || Random.pick(colors),
    band: inputOptions.band || Random.pick(bands),
    starNum: inputOptions.starNum || Random.pick(starNums),
    starType: inputOptions.starType || '',
    border: inputOptions.border || '',
  }
  options.starType ||= options.starNum < 3 ? starTypes[0] : Random.pick(starTypes);
  options.border ||= `card-${starNums.includes(options.starNum) ? options.starNum : 5}${options.starNum == 1 ? `-${options.color}` : ''}`;

  let image;
  try{
    image = await Jimp.read(avatar);
  }catch (e){
    starfxLogger.error(e);
    return;
  }
  const [colorImage, bandImage, starImage, borderImage] = await Promise.all([
    Jimp.read(`${assetsDir}/bangborder/${options.color}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.band}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.starType}.png`),
    Jimp.read(`${assetsDir}/bangborder/${options.border}.png`),
  ]);

  const zoom = 2.0;

  image.cover({w: 500 * zoom, h: 500 * zoom});
  borderImage.cover({w: 500 * zoom, h: 500 * zoom});
  image.composite(borderImage);
  colorImage.cover({w: 130 * zoom, h: 130 * zoom});
  image.composite(colorImage, image.width - colorImage.width - 3 * zoom, 5.5);
  bandImage.width > bandImage.height ? bandImage.resize({w: 120 * zoom}) : bandImage.resize({h: 120 * zoom});
  image.composite(bandImage, 15 * zoom, 15 * zoom);
  starImage.resize({w: 90 * zoom});
  const step = 60 * zoom;
  let hei = 410 * zoom;
  let times = options.starNum;
  while (times > 0) {
    image.composite(starImage, 10 * zoom, hei);
    hei -= step;
    times--;
  }
  return `data:image/png;base64,${(await image.getBuffer("image/jpeg")).toString("base64")}`;
}
