// Local stub for ZNCopyShare (originally served from zero-network.net CDN).
// Provides clipboard copy with a fallback for older Electron/browser contexts.
function ZNCopyShare(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () { _execCopy(text); });
    } else {
        _execCopy(text);
    }
}

function _execCopy(text) {
    var el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity = '0';
    document.body.appendChild(el);
    el.select();
    try { document.execCommand('copy'); } catch (e) {}
    document.body.removeChild(el);
}
