/**
 * RSS and Atom Syndication Feed Parser
 * 
 * Parses XML streams into normalized feed structures with support for:
 * - RSS 2.0 (channel > item)
 * - Atom 1.0 (feed > entry)
 * - Media RSS (media:content, media:thumbnail, enclosure)
 * - Dublin Core metadata (dc:creator, dc:date)
 * - Robust HTML excerpt sanitization
 */

import { XMLParser } from 'fast-xml-parser';
import { CollectionMethod } from '../types';
import { normalizeCanonicalUrl } from './urlNormalizer';
import { normalizeArticleText } from '../utils/textNormalizer';

export interface ParsedFeedItem {
  title: string;
  link: string;
  author?: string;
  publishedAt: string;
  updatedAt?: string;
  excerpt: string;
  imageUrl?: string;
  categories: string[];
  language?: string;
}

export interface ParsedFeed {
  type: CollectionMethod; // 'RSS' | 'ATOM'
  title: string;
  description?: string;
  link?: string;
  language?: string;
  items: ParsedFeedItem[];
}

/**
 * Strips HTML tags and decodes entities to create clean excerpt summaries.
 */
function cleanHtmlExcerpt(htmlContent: string, maxLength = 350): string {
  if (!htmlContent || typeof htmlContent !== 'string') return '';
  return normalizeArticleText(htmlContent, { maxLength });
}

/**
 * Extracts image URL from enclosures, media extensions, or embedded <img> tags.
 */
function extractImageUrl(item: any, rawHtml = ''): string | undefined {
  // Check RSS enclosure
  if (item.enclosure && item.enclosure['@_type']?.startsWith('image/') && item.enclosure['@_url']) {
    return item.enclosure['@_url'];
  }

  // Check media:content
  if (item['media:content']) {
    const mc = item['media:content'];
    if (Array.isArray(mc)) {
      const img = mc.find((m) => m['@_url'] && (m['@_medium'] === 'image' || m['@_type']?.startsWith('image/')));
      if (img) return img['@_url'];
      if (mc[0]?.['@_url']) return mc[0]['@_url'];
    } else if (mc['@_url']) {
      return mc['@_url'];
    }
  }

  // Check media:thumbnail
  if (item['media:thumbnail']) {
    const thumb = item['media:thumbnail'];
    if (Array.isArray(thumb) && thumb[0]?.['@_url']) return thumb[0]['@_url'];
    if (thumb['@_url']) return thumb['@_url'];
  }

  // Fallback: search for <img src="..."> in HTML content
  if (rawHtml) {
    const match = rawHtml.match(/<img[^>]+src=["'](https?:\/\/[^"'>]+)["']/i);
    if (match && match[1]) {
      return match[1];
    }
  }

  return undefined;
}

/**
 * Standardizes raw date strings into ISO-8601 strings.
 */
function parseDateToIso(dateStr?: any): string {
  if (!dateStr) return new Date().toISOString();
  try {
    const parsed = new Date(dateStr);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch {
    // ignore
  }
  return new Date().toISOString();
}

/**
 * Extracts a normalized 2-letter ISO language code from feed metadata.
 */
function extractLanguage(val: any): string | undefined {
  if (!val) return undefined;
  const str = typeof val === 'string' ? val : val?.['#text'];
  if (typeof str === 'string' && str.trim()) {
    const code = str.split(/[-_]/)[0].toLowerCase().trim();
    if (code.length >= 2 && code.length <= 3) {
      return code;
    }
  }
  return undefined;
}

/**
 * Parses XML feed content into a structured ParsedFeed object.
 */
export function parseSyndicationXml(xmlText: string): ParsedFeed {
  if (!xmlText || typeof xmlText !== 'string') {
    throw new Error('Feed content is empty or not a valid string.');
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
    trimValues: true,
  });

  const parsed = parser.parse(xmlText);

  // Check if Atom Feed
  if (parsed.feed && parsed.feed.entry) {
    const feed = parsed.feed;
    const feedLang = extractLanguage(feed['@_xml:lang'] || feed.language || feed['dc:language']);
    const title = typeof feed.title === 'string' ? feed.title : feed.title?.['#text'] || 'Atom Feed';
    let entries = Array.isArray(feed.entry) ? feed.entry : [feed.entry];

    const items: ParsedFeedItem[] = entries.map((e: any) => {
      // Find link
      let linkUrl = '';
      if (Array.isArray(e.link)) {
        const altLink = e.link.find((l: any) => l['@_rel'] === 'alternate') || e.link[0];
        linkUrl = altLink?.['@_href'] || '';
      } else if (e.link && typeof e.link === 'object') {
        linkUrl = e.link['@_href'] || '';
      } else if (typeof e.link === 'string') {
        linkUrl = e.link;
      }

      // Title
      const itemTitle = typeof e.title === 'string' ? e.title : e.title?.['#text'] || 'Untitled Article';

      // Author
      let author = '';
      if (e.author?.name) {
        author = typeof e.author.name === 'string' ? e.author.name : e.author.name['#text'];
      }

      // Language
      const itemLang = extractLanguage(e['@_xml:lang'] || e.language || e['dc:language']) || feedLang;

      // Excerpt & Raw Content
      const rawSummary = typeof e.summary === 'string' ? e.summary : e.summary?.['#text'] || '';
      const rawContent = typeof e.content === 'string' ? e.content : e.content?.['#text'] || '';
      const excerpt = cleanHtmlExcerpt(rawSummary || rawContent || itemTitle);

      // Categories
      const categories: string[] = [];
      if (e.category) {
        const cats = Array.isArray(e.category) ? e.category : [e.category];
        cats.forEach((c: any) => {
          const term = c['@_term'] || c['@_label'] || (typeof c === 'string' ? c : '');
          if (term) categories.push(String(term));
        });
      }

      const imageUrl = extractImageUrl(e, rawContent || rawSummary);
      const publishedAt = parseDateToIso(e.published || e.updated);

      return {
        title: normalizeArticleText(itemTitle),
        link: normalizeCanonicalUrl(linkUrl),
        author: author ? normalizeArticleText(author) : undefined,
        publishedAt,
        updatedAt: e.updated ? parseDateToIso(e.updated) : undefined,
        excerpt,
        imageUrl,
        categories,
        language: itemLang,
      };
    }).filter((item: ParsedFeedItem) => Boolean(item.link && item.title));

    return {
      type: 'ATOM',
      title: normalizeArticleText(title),
      description: feed.subtitle ? normalizeArticleText(String(feed.subtitle)) : undefined,
      language: feedLang,
      items,
    };
  }

  // Check if RSS Feed (2.0 or 0.9x)
  if (parsed.rss?.channel || parsed['rdf:RDF']) {
    const channel = parsed.rss?.channel || parsed['rdf:RDF']?.channel || parsed.channel;
    if (!channel) {
      throw new Error('Valid RSS root found but channel element is missing.');
    }

    const feedLang = extractLanguage(channel.language || channel['dc:language'] || channel['@_xml:lang']);
    const title = typeof channel.title === 'string' ? channel.title : channel.title?.['#text'] || 'RSS Channel';
    const channelItems = channel.item || [];
    const rawItems = Array.isArray(channelItems) ? channelItems : [channelItems];

    const items: ParsedFeedItem[] = rawItems.map((item: any) => {
      const itemTitle = typeof item.title === 'string' ? item.title : item.title?.['#text'] || 'Untitled Article';
      let linkUrl = item.link || item.guid || '';
      if (typeof linkUrl === 'object') {
        linkUrl = linkUrl['#text'] || linkUrl['@_href'] || '';
      }

      // Author / dc:creator
      const author = item['dc:creator'] || item.author || '';
      const authorStr = typeof author === 'string' ? author : author?.['#text'] || '';

      // Language
      const itemLang = extractLanguage(item.language || item['dc:language'] || item['@_xml:lang']) || feedLang;

      // Description / content:encoded
      const rawDesc = item.description || '';
      const rawContent = item['content:encoded'] || '';
      const rawHtml = typeof rawContent === 'string' ? rawContent : typeof rawDesc === 'string' ? rawDesc : '';
      const excerpt = cleanHtmlExcerpt(rawHtml || itemTitle);

      // Categories
      const categories: string[] = [];
      if (item.category) {
        const cats = Array.isArray(item.category) ? item.category : [item.category];
        cats.forEach((c: any) => {
          const val = typeof c === 'string' ? c : c['#text'] || '';
          if (val) categories.push(normalizeArticleText(String(val)));
        });
      }

      const imageUrl = extractImageUrl(item, rawHtml);
      const publishedAt = parseDateToIso(item.pubDate || item['dc:date'] || item.date);

      return {
        title: normalizeArticleText(itemTitle),
        link: normalizeCanonicalUrl(String(linkUrl)),
        author: authorStr ? normalizeArticleText(authorStr) : undefined,
        publishedAt,
        excerpt,
        imageUrl,
        categories,
        language: itemLang,
      };
    }).filter((item: ParsedFeedItem) => Boolean(item.link && item.title));

    return {
      type: 'RSS',
      title: normalizeArticleText(title),
      description: channel.description ? normalizeArticleText(String(channel.description)) : undefined,
      language: feedLang,
      items,
    };
  }

  throw new Error('Unrecognized syndication format. XML lacks standard <rss> or <feed> structure.');
}
