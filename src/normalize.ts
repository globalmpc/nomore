const STOPWORDS = new Set(
  ("a an the and or but if then so to of in on at by for from with about as into is are was were be been am " +
    "it its this that these those i me my we us our you your he she they them their do does did don t s " +
    "not no please here there just very can will would should could have has had").split(" "),
);

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "<url>")
    // name.ext needs a name of 2+ chars with a letter, so "e.g." and "24.x" stay text.
    .replace(/\S*[/\\]\S*|\b(?=[\w-]*[a-z])[\w-]{2,}\.[a-z][a-z0-9]{0,4}\b/g, "<file>")
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b|\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,}\b/g, "<id>")
    .replace(/\d+/g, "<n>")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(norm: string): string[] {
  // Placeholders stay whole ("<file>"), so they never match the word "file".
  return (norm.match(/<(?:url|file|id|n)>|[\p{L}\p{N}]+/gu) ?? []).filter((t) => !STOPWORDS.has(t));
}
