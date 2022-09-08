//import { JSDOM } from 'jsdom'
//import fetch from 'node-fetch'
import puppeteer from 'puppeteer'
//import TurndownService from 'turndown'
import { promises as fs } from 'fs'
//const html2MD = TurndownService()
import hash from 'hash-string'
import keyword from 'keyword-extractor'

const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
}

const url = 'https://ask.census.gov/prweb/PRServletCustom/app/ECORRAsk2_/YACFBFye-rFIz_FoGtyvDRUGg1Uzu5Mn*/!STANDARD'

const snake_caser = (str) => str.toLowerCase().replace(/\s/g, '_')

const taginator = (str) =>
    keyword.extract(str, {
        language: 'english',
        remove_digits: true,
        return_changed_case: true,
        remove_duplicates: true,
    })

const scrapeFAQ = async ({ page, el, acc, topic_idx, subtopic_idx, topic_name, subtopic_name }) => {
    try {
        const questionText = await (await el.getProperty('textContent')).jsonValue()
        await el.click()
        await page.waitForNetworkIdle()
        await page.waitForTimeout(100)
        const answerNodeCandidates = await page.$$('div.content-inner')
        const answerNode = answerNodeCandidates[8]
        const answerHTML = await (await answerNode.getProperty('innerHTML')).jsonValue()

        //const answerMD = await html2MD.turndown(answerHTML)
        const backLink = await page.$('[data-ctl]')
        // returns to first faq results page
        backLink.click()
        await page.waitForNetworkIdle()
        await page.waitForTimeout(100)

        const output = {
            id: hash(questionText),
            tags: taginator(questionText),
            content: {
                title: questionText,
                markUpText: answerHTML,
            },
            folderMetadata: {
                folderId: snake_caser(subtopic_name),
                name: subtopic_name,
                parentId: snake_caser(topic_name),
            },
        }
        console.log('FAQ scraped:', questionText)
        return acc.concat(output)
    } catch (Error) {
        console.warn('ERROR: scrapeFAQ')
        console.log(Error)
        //acc = acc.concat({ topic_idx, subtopic_idx })
        return acc
    }
}

const getCurrentTopicHandle = async (page, index) => {
    const topics = await page.$$("[node_name='TaxonomyListTreeInner']")
    return topics[index]
}

const getCurrentSubtopicHandle = async (page, topic_idx, subtopic_idx) => {
    const currentTopic = await getCurrentTopicHandle(page, topic_idx)
    //console.log({ currentTopic })
    const topicEl = await currentTopic.$('.content-inner')
    const topicText = await topicEl.getProperty('innerText')
    const topic_name = await topicText.jsonValue()
    console.log({ topic_name })
    const topicParent = await currentTopic.getProperty('parentNode')
    const subtopicEls = await topicParent.$$('tr[data-gargs*=TAX')
    return subtopicEls[subtopic_idx]
}

const json_dir = './json-results/topics.json'

const cfg__linksReducer =
    ({ topic_idx, subtopic_idx, topic_name, subtopic_name, on_page = 0 }) =>
    async (a, c, i, d) => {
        let { page, data: progress } = await a
        await page.waitForNetworkIdle()

        const pagination = await page.$('.pagination-links')

        const faqLinks = await page.$$('a.KM_Article_link')

        // WIP ///////////////////////////////////////////////
        try {
            if (pagination) {
                //console.log('👀 pagination found')
                const pageLinks = await pagination.$$('a')
                const next_page = on_page + 1

                /**
                 * if not first page of results, navigate to proper page
                 */
                if (on_page) {
                    console.log('👉 ON ANOTHER PAGE: ', on_page)

                    const thisPageLink = pageLinks[on_page]
                    //console.log({ thisPageLink })
                    //await page.waitForTimeout(1000)
                    /**
                     * click on the pagination link for the current page...
                     */
                    await thisPageLink.click()
                    await page.waitForNetworkIdle()

                    //console.log('💧 WAITING FOR thisPageLink.click() to effect page')
                    await page.waitForTimeout(100)
                    /**
                     * grab the FAQ links again after click()
                     */
                    const newLinks = await page.$$('a.KM_Article_link')
                    c = newLinks[i]
                }
                /**
                 * if not the first faq on the page, rebuild handlers
                 */
                if (i) {
                    /**
                     * grab the FAQ links again after click()
                     */
                    const newLinks = await page.$$('a.KM_Article_link')
                    c = newLinks[i]
                    //await page.waitForNetworkIdle()
                    /**
                     * last faq on list in this page
                     */
                    if (d.length === i + 1) {
                        /**
                         * retake links (they change in size depending on where you are in the list)
                         */
                        const updatedPagination = await page.$('.pagination-links')
                        const updatedPageLinks = await updatedPagination.$$('a')
                        console.log('🔍 updatedPageLinks.length:', updatedPageLinks.length)
                        console.log('🔍 on_page:', on_page)
                        console.log('🙌 NEXT PAGE COMING UP:', next_page)

                        const newAcc = await scrapeFAQ({
                            page,
                            el: c,
                            acc: progress,
                            topic_idx,
                            subtopic_idx,
                            topic_name,
                            subtopic_name,
                        })
                        // 👀
                        if (updatedPageLinks.length === on_page + 1) {
                            console.log('🔥 Last FAQ on last page! Should move on to next Subtopic')
                            return {
                                page,
                                data: newAcc,
                            }
                        }
                        const nextLinksReducer = cfg__linksReducer({
                            topic_idx,
                            subtopic_idx,
                            topic_name,
                            subtopic_name,
                            on_page: next_page,
                        })

                        await page.waitForTimeout(100)

                        const { data } = await newLinks.reduce(
                            nextLinksReducer,
                            Promise.resolve({ page, data: newAcc })
                        )
                        return {
                            page,
                            data,
                        }
                    }
                }
                /**
                 * not on first page and first FAQ on that page
                 */
                const newAcc = await scrapeFAQ({
                    page,
                    el: c,
                    acc: progress,
                    topic_idx,
                    subtopic_idx,
                    topic_name,
                    subtopic_name,
                })

                return {
                    page,
                    data: newAcc,
                }
            }
            /////////////////////////////////////////////// WIP //

            // not the first FAQ, need to grab the handes again
            if (i) {
                //console.log('not first faq on page')
                //console.log({ links })
                c = faqLinks[i]
            }

            const newAcc = await scrapeFAQ({
                page,
                el: c,
                acc: progress,
                topic_idx,
                subtopic_idx,
                topic_name,
                subtopic_name,
            })

            return { page, data: newAcc }
        } catch (Error) {
            console.log('linksReducer BUSTED! returning progress report:')
            console.log({ Error })
            fs.writeFile(json_dir, JSON.stringify(progress, null, 2)).then(() => console.log('!!! \n SAVED FILE \n!!!'))
        }
    }

/**
 * first error boundary. I.e., doesn't store any progress to filesystem until at
 * least one subtopic's FAQs have been completely scraped
 */
const cfg__subtopicsReducer =
    ({ topic_idx, topic_name }) =>
    async (a, c, subtopic_idx, d) => {
        let { page, data: progress } = await a
        if (subtopic_idx) {
            c = await getCurrentSubtopicHandle(page, topic_idx, subtopic_idx)
        }
        console.log("getting c.$('td') in subtopicsReducer")
        let subtopicEl = await c.$('td')
        // load faqs for subtopic
        const subTopicText = await subtopicEl.getProperty('innerText')

        // pipe down
        const subtopic_name = await subTopicText.jsonValue()

        console.log({ subtopic_name })

        await subtopicEl.click()
        await page.waitForNetworkIdle()
        await page.waitForTimeout(100)

        //await page.waitForTimeout(1000)

        let linkHandles = await page.$$('a.KM_Article_link')

        //console.log({ linkHandles })
        try {
            console.log('linkHandles.reduce...')

            const __linksReducer = cfg__linksReducer({ topic_idx, subtopic_idx, topic_name, subtopic_name })

            let { data: acc } = await linkHandles.reduce(
                __linksReducer,
                Promise.resolve({
                    page,
                    data: progress,
                })
            )

            return {
                page,
                data: acc,
            }
        } catch (Error) {
            console.warn('ERROR: scraping FAQ list')
            console.log({ Error })
            //fs.writeFile(json_dir, JSON.stringify(progress)).then(() =>
            //    console.log('saved progress after scraping FAQ list bailed:', json_dir)
            //)
        }
    }

const width = 1024
const height = 2000

topicPaginator(7) //?

/**
 * TODO:
 * - handle paginated subtopic results
 * - sometimes it just breaks:
 *   - enable starting at a specific subtopic index ✅
 *   - store results and return on error (try catch)
 *
 */
async function topicPaginator(jump_to = 0, progress = []) {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: {
            width,
            height,
        },
    })
    const page = await browser.newPage()
    await page.setViewport({ width: width, height: height })
    await page.goto(url)

    await page.waitForNetworkIdle()

    const topics = await page.$$("[node_name='TaxonomyListTreeInner']")

    try {
        console.log('topics.reduce...')
        const { data: payload } = await topics.reduce(async (a, c, topic_idx, d) => {
            if (topic_idx < jump_to) return await a
            let { page, data: acc } = await a
            if (topic_idx) {
                c = await getCurrentTopicHandle(page, topic_idx)
            }
            c.click()
            await page.waitForNetworkIdle()
            await page.waitForTimeout(100)

            console.log("getting c.$('.content-inner') in topicsPaginator")

            const topicEl = await c.$('.content-inner')
            const topicText = await topicEl.getProperty('innerText')

            // pipe down
            const topic_name = await topicText.jsonValue()

            console.log({ topic_name })

            const topicParent = await c.getProperty('parentNode')
            const subtopicEls = await topicParent.$$('tr[data-gargs*=TAX')

            try {
                console.log('subtopicEls.reduce...')

                const __subtopicsReducer = cfg__subtopicsReducer({ topic_idx, topic_name })
                let { data: subs } = await subtopicEls.reduce(__subtopicsReducer, Promise.resolve({ page, data: acc }))

                return {
                    page,
                    data: subs,
                }
            } catch (Error) {
                console.warn('ERROR: subtopics reducer')
                console.log({ Error })
                //fs.writeFile(json_dir, JSON.stringify(progress)).then(() =>
                //    console.log('saved progress after subtopics reducer bailed:', json_dir)
                //)
            }
        }, Promise.resolve({ page, data: progress }))

        fs.writeFile(json_dir, JSON.stringify(payload)).then(() => console.log('SUCCESS: topics written to:', json_dir))
        //console.log({ out })
    } catch (Error) {
        console.warn('ERROR: topics reducer')
        console.log({ Error })
        //fs.writeFile(json_dir, JSON.stringify(progress)).then(() =>
        //    console.log('saved progress after subtopics reducer bailed:', json_dir)
        //)
    }
    //const todos = Array.from(topics).map((bloop) => console.log({ bloop }))
    //console.log({ topics })

    browser.close()
}
