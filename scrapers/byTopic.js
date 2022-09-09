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

const scrapeFAQ = async ({ page, faqLink, acc, topic_name, subtopic_name }) => {
    try {
        const questionText = await (await faqLink.getProperty('textContent')).jsonValue()
        await faqLink.click()
        await page.waitForNetworkIdle()

        const answerNodeCandidates = await page.$$('div.content-inner')
        const answerNode = answerNodeCandidates[8]

        const watchBack = page.waitForSelector('[data-ctl]')
        const backLink = await watchBack

        // returns to first faq results page
        await backLink.click()
        await page.waitForNetworkIdle()

        const answer = await answerNode.getProperty('innerHTML')
        //const answerMD = await html2MD.turndown(answerHTML)
        const answerHTML = await answer.jsonValue()

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
        console.log(`
            FAQ scraped: ${questionText}
            topic: ${topic_name}
            subtopic: ${subtopic_name}
        `)
        return acc.concat(output)
    } catch (Error) {
        console.warn('ERROR: scrapeFAQ')
        console.log(Error)
        //acc = acc.concat({ topic_idx, subtopic_idx })
        await page.waitForTimeout(100)

        return acc
    }
}

const getCurrentTopicHandle = async (page, index) => {
    const topics = await page.$$("[node_name='TaxonomyListTreeInner']")
    return topics[index]
}

const getCurrentSubtopicHandle = async (page, topic_idx, subtopic_idx) => {
    const currentTopic = await getCurrentTopicHandle(page, topic_idx)
    const topicParent = await currentTopic.getProperty('parentNode')
    const subtopicEls = await topicParent.$$('tr[data-gargs*=TAX')
    return subtopicEls[subtopic_idx]
}

const json_dir = './json-results/topics.json'

const cfg__linksReducer =
    ({ topic_name, subtopic_name, on_page = 0 }) =>
    async (a, c, i, d) => {
        let { page, data: progress } = await a

        console.log(`FAQ list item ${i} on page ${on_page}:`)

        const pageLinks = await page.$$('.pagination-links a')

        try {
            if (pageLinks.length) {
                const next_page = on_page + 1
                if (on_page) {
                    const thisPageLink = pageLinks[on_page]

                    console.log(`clicking on THIS page 👆 -> ${on_page}`)
                    await thisPageLink.click()
                    await page.waitForNetworkIdle()
                    await page.waitForTimeout(100)
                }

                // faqLinks are lost every iteration
                const faqLinks = await page.$$('a.KM_Article_link')

                // LAST LINK ON LAST PAGE ///////////////////////////////////////////////

                if (faqLinks.length === i + 1) {
                    const newAcc = await scrapeFAQ({
                        page,
                        faqLink: faqLinks[i],
                        acc: progress,
                        topic_name,
                        subtopic_name,
                    })
                    console.log(
                        'last faq link in list/page\n' +
                            '<...> retargeting :\n' +
                            '(list size changes depending where you are in the list)\n' +
                            `🔍 on_page: ${on_page}\n` +
                            `🙌 PAGE COMING UP NEXT: ${next_page}`
                    )

                    let updatedPagination
                    try {
                        updatedPagination = await page.waitForSelector('.pagination-links', {
                            timeout: 2000,
                        })
                    } catch (err) {
                        console.log('stuck waiting for pagination links...')
                        try {
                            const watchBack = page.waitForSelector('[data-ctl]', { timeout: 2000 })
                            const backLink = await watchBack
                            await backLink.click()
                            console.log('waiting for updatedPagination timeout')
                            updatedPagination = await page.waitForSelector('.pagination-links', {
                                timeout: 2000,
                            })
                        } catch (err) {
                            console.log('waiting for backlink timeout')
                        }
                    }

                    const updatedPaginationMenu = await updatedPagination

                    const updatedPageLinks = await updatedPaginationMenu.$$('a')

                    const pages_number = updatedPageLinks.length - 2

                    if (pages_number === on_page) {
                        console.log('🔥 finished last item in list on last page 🔥')
                        return {
                            page,
                            data: newAcc,
                        }
                    }

                    const nextPageLink = updatedPageLinks[next_page]

                    console.log(`clicking on NEXT page 👆 -> ${next_page}`)
                    await nextPageLink.click()
                    await page.waitForNetworkIdle()
                    await page.waitForTimeout(100)
                    const nextFaqLinks = await page.$$('a.KM_Article_link')

                    const nextLinksReducer = cfg__linksReducer({
                        topic_name,
                        subtopic_name,
                        on_page: next_page,
                    })

                    const { data } = await nextFaqLinks.reduce(
                        nextLinksReducer,
                        Promise.resolve({ page, data: newAcc })
                    )
                    return {
                        page,
                        data,
                    }
                }
                /////////////////////////////////////////////// LAST LINK ON LAST PAGE //

                //const faqLinks = await page.$$('a.KM_Article_link')
                const newAcc = await scrapeFAQ({
                    page,
                    faqLink: faqLinks[i],
                    acc: progress,
                    topic_name,
                    subtopic_name,
                })

                return {
                    page,
                    data: newAcc,
                }
            }

            const faqLinks = await page.$$('a.KM_Article_link')
            const newAcc = await scrapeFAQ({
                page,
                faqLink: faqLinks[i],
                acc: progress,
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
        //console.log("getting c.$('td') in subtopicsReducer")
        let subtopicEl = await c.$('td')
        // load faqs for subtopic
        const subTopicText = await subtopicEl.getProperty('innerText')

        // pipe down
        const subtopic_name = await subTopicText.jsonValue()

        console.log({ subtopic_name })

        await subtopicEl.click()
        await page.waitForNetworkIdle()
        //await page.waitForTimeout(100)

        //await page.waitForTimeout(1000)

        let linkHandles = await page.$$('a.KM_Article_link')

        //console.log({ linkHandles })
        try {
            //console.log('linkHandles.reduce...')

            const __linksReducer = cfg__linksReducer({ topic_name, subtopic_name })

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

topicPaginator() //?

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
        const { data: payload } = await topics.reduce(async (a, c, topic_idx, d) => {
            if (topic_idx < jump_to) return await a
            let { page, data: acc } = await a
            if (topic_idx) {
                c = await getCurrentTopicHandle(page, topic_idx)
            }
            c.click()
            await page.waitForNetworkIdle()
            //await page.waitForTimeout(100)

            const topicEl = await c.$('.content-inner')
            const topicText = await topicEl.getProperty('innerText')

            // pipe down
            const topic_name = await topicText.jsonValue()

            console.log({ topic_name })

            const topicParent = await c.getProperty('parentNode')
            const subtopicEls = await topicParent.$$('tr[data-gargs*=TAX')

            try {
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
