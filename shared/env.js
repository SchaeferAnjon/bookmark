// 运行环境：Chrome 与 Safari 共用同一套代码，按「能力」分支而不是按浏览器名。
// Safari 没有 bookmarks / _favicon；它的扩展页 URL 是 safari-web-extension://。
import './compat.js';

const manifest = chrome.runtime.getManifest();

export const HAS_BOOKMARKS = !!globalThis.chrome?.bookmarks;
export const HAS_FAVICON_API = (manifest.permissions || []).includes('favicon');
export const IS_SAFARI = chrome.runtime.getURL('').startsWith('safari-web-extension:');

// Mac App（BookmarkKeeper.app）注册的 Chrome 本地通信程序名；Safari 下这个参数会被忽略，
// 消息总是发给扩展所在 App 自带的处理程序。
export const NATIVE_HOST = 'io.github.schaeferanjon.bookmarkkeeper';
export const APP_DOWNLOAD_URL = 'https://github.com/SchaeferAnjon/bookmark/releases/latest';
