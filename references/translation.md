# 同步翻译与直播接入

只有原文时，构建器允许省略 `zh`，但必须提供翻译接口。它不会自动取得第三方账号、安装模型或调用未配置的服务。

## 翻译服务

有现成兼容接口时可直接使用。协议：`POST /translate`，JSON 为 `{"text":"Hello","source":"en","target":"zh"}`，成功响应 `{"zh":"你好"}`。失败返回非 2xx。支持 HTTPS，以及本机 loopback HTTP。

仓库附带 `scripts/translation_server.py`：把上述请求转换为 Chat Completions 请求，只监听 `127.0.0.1`。使用用户指定的服务完整 URL 与模型；服务商 API 密钥通过进程环境变量 `CAPTION_API_KEY` 提供，不写入生成的脚本。没有 API 密钥的本机兼容模型也可使用。它不是免费的内置翻译模型；配置远程服务后，待翻译字幕会发送到该服务，并按其规则计费。

```bash
# 先在本机安全配置 CAPTION_API_KEY（如服务需要），不要将密钥写入仓库。
python3 scripts/translation_server.py \
  --upstream 'https://YOUR_PROVIDER/v1/chat/completions' \
  --model 'YOUR_MODEL' \
  --token-file /tmp/video-captions.token
```

该进程持续运行期间，终端会显示本机翻译 URL。token 文件首次以仅当前用户可读写的权限创建，之后复用。它是本机接口访问凭证，与服务商 API 密钥不同；生成的用户脚本含此 token，不要公开分享。停止使用时结束自己启动的进程，不终止未知翻译/安装服务。

服务只接受中英字幕请求，提供鉴权、请求大小限制和上游超时，不记录字幕或密钥。上游协议参见 [Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

## 录播边播边译

```bash
python3 scripts/build_userscript.py \
  --data captions.en.json --mode stream \
  --translation-url http://127.0.0.1:8766/translate \
  --token-file /tmp/video-captions.token \
  --match 'https://example.com/watch/lesson-1' --output lesson.user.js
```

输入为 `{"cues":[{"start":0,"end":3,"en":"Hello"}]}`，也可部分已有 `zh`；已有译文直接复用。将 `--mode stream` 改成 `--mode full` 就是先翻完整段的初始模式，窗口内仍可切换。旧的完整英中 JSON 和无服务构建方式保持可用。

## 直播

```bash
python3 scripts/build_userscript.py --live \
  --translation-url http://127.0.0.1:8766/translate \
  --token-file /tmp/video-captions.token \
  --match 'https://example.com/live/channel-1' --output live.user.js
```

默认查找当前可见 video 的启用英文 captions/subtitles 轨道并读取 `activeCues`。不能取得 `disabled` 轨道的活动字幕，因此提示开启平台英文 CC，不擅自更改轨道模式。参见 [TextTrack.mode](https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/mode)。

若平台把字幕渲染在普通 DOM 中，检查当前页面后增加 `--source-selector '<实际的英文字幕CSS选择器>'`。选择器应只匹配当前字幕行，不包括整个滚动转写历史、翻译面板或中文字幕。无匹配时提示等待；选择器语法错误时给出配置错误。多个播放器可用 `--video-selector '<实际视频CSS选择器>'` 精确指定。播放器在不可访问 iframe 内时不能靠父页面选择器读取。

字幕修订会取消旧任务，短暂稳定后再请求；字幕消失时清空译文。暂时没有字幕与长期无可读字幕源需要现场区分，不能据此假称正在进行语音识别。无字幕直播需另接实时 ASR，再适配可读取的字幕源。

## 请求权限与验收

生成器只为在线翻译脚本添加 `GM_xmlhttpRequest` 以及目标主机的 `@connect`，不授予任意主机访问。使用篡改猴正常授权；不要以页面 `fetch` 绕过混合内容、跨域或本机网络限制。接口行为见 [Tampermonkey 文档](https://www.tampermonkey.net/documentation.php#api:GM_xmlhttpRequest)。

运行时参数集中在 `assets/translation-runtime.js`：录播预取未来 15 秒，直播文本稳定约 350 毫秒后请求；3 秒为高延迟提示阈值，单请求最多等待 12 秒。实际延迟还取决于平台出字幕速度、网络、模型。逐句翻译不是逐 token 输出；尚未译完的句子显示原文，超时/错误可重试。请用实际视频验证是否符合用户对观感的要求。

已完成译文在当前页面内存中复用；不会跨页面永久保存。直播历史缓存有上限，刷新后需重新翻译。需要长期离线使用时，另将完整译文整理为 JSON，再按离线方式构建。
