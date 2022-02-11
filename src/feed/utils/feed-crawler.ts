import * as RssParser from 'rss-parser';
import { PromisePool } from '@supercharge/promise-pool';
import { FeedInfo } from '../../resources/feed-info-list';
import * as dayjs from 'dayjs';
const ogs = require('open-graph-scraper');

type OgsResponse = { result: { favicon: string; ogImage: { url: string; type: string; title: string } } };
export type FeedItemOgpImageMap = Map<string, string>;
export type Feed = RssParser.Output<RssParser.Item>;

export class FeedCrawler {
  private rssParser;

  constructor() {
    this.rssParser = new RssParser();
  }

  async fetchFeedsAsync(feedInfoList: FeedInfo[], concurrency: number): Promise<Feed[]> {
    FeedCrawler.validateFeedInfoList(feedInfoList);

    const feedInfoListLength = feedInfoList.length;
    let fetchProcessCounter = 1;

    const feeds: Feed[] = [];

    await PromisePool.for(feedInfoList)
      .withConcurrency(concurrency)
      .handleError(async (error, feedInfo) => {
        console.error('[fetch-feed] error', `${fetchProcessCounter++}/${feedInfoListLength}`, feedInfo.label);
        console.error(error);
      })
      .process(async (feedInfo) => {
        const feed = await this.rssParser.parseURL(feedInfo.url);
        console.log('[fetch-feed] fetched', `${fetchProcessCounter++}/${feedInfoListLength}`, feedInfo.label);
        feeds.push(feed);
      });

    return feeds;
  }

  /**
   * フィード情報のチェック
   */
  private static validateFeedInfoList(feedInfoList: FeedInfo[]) {
    const allLabels = feedInfoList.map((feedInfo) => feedInfo.label);
    const allUrls = feedInfoList.map((feedInfo) => feedInfo.url);

    const labelSet = new Set<string>();
    const urlSet = new Set<string>();

    // label の重複チェック
    for (const label of allLabels) {
      if (labelSet.has(label)) {
        throw new Error(`フィードのラベル「${label}」が重複しています`);
      }
      labelSet.add(label);
    }

    // url の重複チェック
    for (const url of allUrls) {
      if (urlSet.has(url)) {
        throw new Error(`フィードのURL「${url}」が重複しています`);
      }
      urlSet.add(url);
    }
  }

  /**
   * 取得したフィードの調整
   */
  postProcessFeeds(feeds: Feed[], filterArticleDate: Date) {
    const filterIsoDate = filterArticleDate.toISOString();

    for (const feed of feeds) {
      let feedItems = feed.items;

      // 公開日時でフィルタ
      feedItems = feedItems.filter((feedItem) => {
        return feedItem.isoDate > filterIsoDate;
      });

      // ブログごとの調整
      switch (feed.link) {
        // 9時間ずれているので調整
        case 'https://engineering.mercari.com/blog/feed.xml':
          for (const feedItem of feedItems) {
            feedItem.isoDate = dayjs(feedItem.isoDate).subtract(9, 'h').toISOString();
            feedItem.pubDate = dayjs(feedItem.pubDate).subtract(9, 'h').toISOString();
          }
          break;
      }

      // 全ブログの調整
      for (const feedItem of feedItems) {
        // 「記事タイトル | ブログ名」の形にする
        feedItem.title = `${feedItem.title} | ${feed.title}`;
      }

      feed.items = feedItems;
    }

    return feeds;
  }

  mergeAndSortResults(feeds: Feed[]) {
    let allFeedItems: RssParser.Item[] = [];

    // マージ
    for (const feed of feeds) {
      allFeedItems = allFeedItems.concat(feed.items);
    }

    // 日付でソート
    allFeedItems.sort((a, b) => {
      return -1 * a.isoDate.localeCompare(b.isoDate);
    });

    return allFeedItems;
  }

  async fetchFeedItemOgpImageMap(feedItems: RssParser.Item[], concurrency: number): Promise<FeedItemOgpImageMap> {
    const feedItemOgpImageMap: FeedItemOgpImageMap = new Map();
    const feedItemsLength = feedItems.length;
    let fetchProcessCounter = 1;

    await PromisePool.for(feedItems)
      .withConcurrency(concurrency)
      .handleError(async (error, feedItem) => {
        console.error('[fetch-feed-ogp] error', `${fetchProcessCounter++}/${feedItemsLength}`, feedItem.title);
        console.error(error);
      })
      .process(async (feedItem) => {
        const ogsResponse: OgsResponse = await ogs({
          url: feedItem.link,
          timeout: 10 * 1000,
        });
        feedItemOgpImageMap.set(feedItem.link, ogsResponse.result.ogImage.url);
        console.log('[fetch-feed] fetched', `${fetchProcessCounter++}/${feedItemsLength}`, feedItem.title);
      });

    return feedItemOgpImageMap;
  }
}
