// Colors big files away from the page, so highlighting never stalls typing in the Files tab.
importScripts('/vendor/hljs.js');
onmessage = ({ data: { id, text, lang } }) => postMessage({ id, html: self.hljs.highlight(text, { language: lang, ignoreIllegals: true }).value });
