// Put text on the clipboard, by whichever route this browser allows.
//
// The async clipboard API is refused on an insecure origin and in some
// in-app browsers; the old execCommand still works in most of those. True
// when the text is on the clipboard, false when the caller should show the
// text so it can be copied by hand rather than look like nothing happened.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* try the old way */ }
  try {
    const box = document.createElement('textarea');
    box.value = text;
    box.setAttribute('readonly', '');
    box.style.position = 'fixed';
    box.style.opacity = '0';
    document.body.appendChild(box);
    box.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(box);
    return ok;
  } catch {
    return false;
  }
}
