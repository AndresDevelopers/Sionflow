export type ChurchNewsItem = {
  title: string;
  link: string;
  publishedAt: string;
};

const RSS_URL = 'https://newsroom.churchofjesuschrist.org/rss';

const stripCdata = (value: string): string => value.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();

const decodeXml = (value: string): string =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const getTag = (block: string, tag: string): string => {
  const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match?.[1]?.trim() ?? '';
};

export const parseChurchNewsRss = (rss: string): ChurchNewsItem[] => {
  const items = rss.match(/<item>[\s\S]*?<\/item>/gi) ?? [];

  return items
    .map((item) => {
      const title = decodeXml(stripCdata(getTag(item, 'title')));
      const link = decodeXml(stripCdata(getTag(item, 'link')));
      const publishedAt = decodeXml(stripCdata(getTag(item, 'pubDate')));

      return {
        title,
        link,
        publishedAt,
      };
    })
    .filter((item) => item.title && item.link)
    .slice(0, 6);
};

export async function fetchLatestChurchNews(): Promise<ChurchNewsItem[]> {
  const response = await fetch(RSS_URL, {
    next: { revalidate: 900, tags: ['church-news'] },
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch Church newsroom RSS: ${response.status}`);
  }

  const rss = await response.text();
  return parseChurchNewsRss(rss);
}
