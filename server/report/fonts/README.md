# 报告中文字体

`NotoSansSC.ttf` 来自 Noto CJK 官方仓库：
https://github.com/notofonts/noto-cjk/blob/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf

许可证为 SIL Open Font License 1.1，见 LICENSE.txt。仅服务器生成 PDF 使用，
不打入小程序包，不访问远程字体服务。部署时须连同本目录一起复制。

用 fontTools.varLib.instancer 固定 wght=400，得到常规字重静态 TTF，
避免 PDF 渲染器采用可变字体的最细默认字重。保留原许可和字体名称。
