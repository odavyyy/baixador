// Reading a pasted block of text as a list of links (batch download).

export const MAX_BATCH_LINKS = 100;

/** Every http(s) link in the text, in order, without repeats. */
export function extractUrls(text: string): { urls: string[]; duplicates: number } {
  const found = (text.match(/https?:\/\/[^\s<>"']+/gi) ?? []).map((u) => {
    let s = u.replace(/[.,;!]+$/, '');
    // "(see https://x.com/a)" ends with a ")" that is not part of the link
    while (s.endsWith(')') && s.split(')').length > s.split('(').length) s = s.slice(0, -1);
    return s;
  });
  const urls = [...new Set(found)];
  return { urls, duplicates: found.length - urls.length };
}
