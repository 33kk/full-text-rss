import { Feed } from "feed";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { promises as fs } from "fs";
import Keyv from "keyv";
import RSSParser from "rss-parser";
import Fastify from "fastify";
import fetch from "node-fetch";
import path from "path";
import crypto from "crypto";

const rssParser = new RSSParser();
const fastify = Fastify({ logger: true });
const cache = new Keyv();

fastify.get("/", async (req, res) => {
	const url = req.query["url"];
	const selector = req.query["selector"];
	const selectorText = req.query["selectorText"];
	console.log(url, "---", selector);
	const cached = false && (await cache.get(url));
	if (!cached) {
		const feed = await rssParser.parseURL(url);
		for (const item of feed.items) {
			const readable = await getReadablePage(item.link, selector, selectorText);
			if (readable) {
				item.content = readable;
				item["content:encoded"] = readable;
			}
		}
		const result = feedToXml(feed);
		await cache.set(url, result, 10 * 60 * 60 * 1000);
		res.status(200).header("Content-Type", "text/xml").send(result);
	}
	res.status(200).header("Content-Type", "text/xml").send(cached);
});

async function exists(path: string) {
	try {
		await fs.stat(path);
		return true;
	} catch {
		return false;
	}
}

async function getReadablePage(url: string, selector?: string, selectorText?: string) {
	const hash = md5(url);
	if (await exists(path.resolve(__dirname, "cache", hash))) {
		return await fs.readFile(path.resolve(__dirname, "cache", hash), {
			encoding: "utf8",
		});
	} else {
		console.log("Downloading article at", url);
		let html = await fetch(url).then((r) => r.text());
		if (selector) {
			const doc = new JSDOM(html, { url });
			try {
				let els = doc.window.document.querySelectorAll(selector);
				if (selectorText) {
					for (const el of els) {
						if (el.textContent?.includes(selectorText)) {
							url = el?.href;
							break;
						}
					}
				}
				else {
					url = els[0]?.href;
				}
				if (!url) return undefined;
				html = await fetch(url).then((r) => r.text());
			}
			catch (e) {
				console.error("selector error", e)
				return undefined
			}
		}
		const readable = await readability(url, html);
		if (readable)
			await fs.writeFile(path.resolve(__dirname, "cache", hash), readable, {
				encoding: "utf8",
			});
		return readable;
	}
}

async function readability(url: string, html: string) {
	const doc = new JSDOM(html, { url });
	const reader = new Readability(doc.window.document);
	const readable = reader.parse()?.content;
	return readable;
}

function md5(str: string) {
	return crypto.createHash("md5").update(str).digest("hex");
}

function feedToXml(feed: RSSParser.Output) {
	const newFeed = new Feed({
		id: feed.link,
		link: feed.link,
		title: feed.title,
		description: feed.description,
		copyright: feed.title,
		favicon: feed.image?.url,
		image: feed.image?.url,
	});
	for (const item of feed.items) {
		newFeed.addItem({
			title: item.title,
			guid: item.guid,
			date: new Date(item.isoDate),
			link: item.link,
			author: [{ name: item.creator }],
			content: item["content:encoded"] || item.content,
			category: item.categories?.map((e: string) => {
				return { name: e };
			}),
		});
	}
	return newFeed.rss2();
}

async function main() {
	try {
		await fastify.listen(+process.env["PORT"] || 3000);
	} catch (e) {
		console.log("Server start failed", e);
	}
}

main();
