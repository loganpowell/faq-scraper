//import { JSDOM } from 'jsdom'
//import fetch from 'node-fetch'
const puppeteer = require('puppeteer')
//const TurndownService = require('turndown')
const fs = require('fs')
//const html2MD = TurndownService()

const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
}

const url =
    'https://ask.census.gov/prweb/PRServletCustom/app/ECORRAsk2_/YACFBFye-rFIz_FoGtyvDRUGg1Uzu5Mn*/!STANDARD'

const getHtml = async () => {
    const html = await fetch(url, {
        method: 'GET',
        headers,
    })
        .then((r) => r.text())
        .catch((e) => {
            console.log('error fetching:', e)
            return ''
        })

    const { window } = await new JSDOM(html)

    console.log(window)
}

const getIndexByClassName = (className, list) => {
    return list.findIndex((x) => x.className === className)
}

/**
 * TODO:
 * Make work with "..." pagination (or just kludge)
 */

const skipFirstPages = async (page) => {
    console.log('skipFirstPages')
    const dotdot = await page.$$(
        'content-item content-label item-3 remove-all-spacing standard_dataLabelWrite'
    )
    console.log({ dotdot })
    await page.evaluate(() => {
        const dotdot = document.getElementsByClassName(
            'content-item content-label item-3 remove-all-spacing standard_dataLabelWrite'
        )[0]
        console.log('dotdot', dotdot)
        const clicker = dotdot.querySelector('a')
        console.log('clicker', clicker)
        clicker.click()
        //return clicker
    })

    await page.waitForNetworkIdle()
}

const export_structure = {
    id: 'String',
    tags: ['String', 'String', '...'],
    content: {
        title: 'String',
        markUpText: 'HTML String',
    },
    folderMetadata: {
        folderId: 'String', // subtopic ID
        name: 'String', // subtopic name
        parentId: 'String', // topic ID
    },
}

const fetchArticle = async (page, qLink, acc, i, PAGE, list = 0) => {
    console.log('fetchArticle', { PAGE, list })
    try {
        const questionText = await (
            await qLink.getProperty('textContent')
        ).jsonValue()
        //  console.log({ qLink });
        await qLink.click()
        await page.waitForNetworkIdle()
        //  await page.waitForTimeout(2000);
        const answerNodeCandidates = await page.$$('div.content-inner')
        const answerNode = answerNodeCandidates[8]
        const answerHTML = await (
            await answerNode.getProperty('innerHTML')
        ).jsonValue()

        //const answerMD = await html2MD.turndown(answerHTML)
        const backLink = await page.$('[data-ctl]')
        backLink.click()
        await page.waitForNetworkIdle()
        //  await page.waitForTimeout(2000);
        if (list !== 0) {
            await skipFirstPages(page)
            await page.waitForNetworkIdle()
        }

        return acc.concat({ questionText, answerHTML, PAGE, i })
    } catch (err) {
        console.log({ PAGE, i, err })
        return acc.concat({ PAGE, i })
    }
}

const configParsePage = ({ page, progress, list, browser }) =>
    async function parsePage(elementHandles, PAGE = 0) {
        try {
            return await elementHandles.reduce(async (a, qLink, i) => {
                const acc = await a
                // need to navigate to any page other than first on every new page parsing
                const pagination = await page.$('.pagination-links')
                const pageLinks = await pagination.$$('a')

                //const pageLinksArray = Array.from(pageLinks)
                //const currentPageIndex = getIndexByClassName(
                //    pageLinksArray,
                //    'inactiveLink'
                //)
                const NEXT_PAGE = PAGE + 1
                const nextPageNavLink = pageLinks[NEXT_PAGE]
                //await nextPageNavLink.click()
                if (PAGE !== 0) {
                    const thisPageLink = pageLinks[PAGE]
                    await thisPageLink.click()
                    await page.waitForNetworkIdle()
                }
                if (i !== 0) {
                    // reparse article link list every iteration (original nodes are lost)
                    await page.waitForNetworkIdle()
                    const newHandles = await page.$$('a.KM_Article_link')
                    qLink = newHandles[i]
                    if (elementHandles.length === i + 1) {
                        console.log('NEXT PAGE:', NEXT_PAGE)
                        const nextPageHandles = await page.$$(
                            'a.KM_Article_link'
                        )
                        const newAcc = await fetchArticle(
                            page,
                            qLink,
                            acc,
                            i,
                            PAGE,
                            list
                        )
                        progress = newAcc
                        return newAcc.concat(
                            await parsePage(
                                nextPageHandles,
                                NEXT_PAGE,
                                nextPageNavLink
                            )
                        )
                    }
                }
                progress = acc
                return await fetchArticle(page, qLink, acc, i, PAGE)
            }, Promise.resolve([]))
        } catch (err) {
            console.log('BUSTED! returning progress report:', err)
            fs.writeFileSync(
                `./json-results/list-${list}.json`,
                JSON.stringify(progress, null, 2),
                'utf-8'
            )
            browser.close()

            //return
        }
    }

const width = 1024
const height = 2000
//getHtml();

;({
    recycle: true, //<--
})

const topicPaginator = async (list = 0, progress = []) => {
    console.log('topicPaginator', `list = ${list}`)
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
    /* ignore coverage */
    const topicMenu = await page.$("[node_name='TaxonomyListTree']")

    const topics = await page.$$("[node_name='TaxonomyListTreeInner']")

    const out = await topics.reduce(async (a, c, i, d) => {
        const acc = await a
        c.click()
        await page.waitForNetworkIdle()
        const topicEl = await c.$('.content-inner')
        const topicText = await topicEl.getProperty('innerText')
        const topic_name = await topicText.jsonValue()
        console.log({ topic_name })
        const topicParent = await c.getProperty('parentNode')
        const subtopicEls = await topicParent.$$('tr[data-gargs*=TAX')
        const subtopics = await subtopicEls.reduce(async (a, c, i, d) => {
            const acc = await a
            const subtopicEl = await c.$('td')
            const subTopicText = await subtopicEl.getProperty('innerText')
            const subtopic_name = await subTopicText.jsonValue()
            console.log({ subtopic_name })
            return [...acc, { subtopic_name }]
        }, Promise.resolve([]))
        return [...acc, { [topic_name]: subtopics }]
    }, Promise.resolve([]))

    console.log({ out })
    //const todos = Array.from(topics).map((bloop) => console.log({ bloop }))
    //console.log({ topics })

    //const body = await page.$('body')
    //console.log({ body })

    //page.on('console', (log) => console[log._type](log._text))

    //const nodeList = await page.evaluate((_body) => {
    //console.log('in body', _body)
    //return _body
    //return _body.querySelector("[node_name='TaxonomyListTree']")
    //let table = _body.querySelector("[node_name='TaxonomyListTree']")

    //let topics = table.querySelectorAll(
    //    "[node_name='TaxonomyListTreeInner']"
    //)
    //return Array.from(topics).map((topic) => {
    //    topic.click()
    //    const subtopics = topic.querySelectorAll('tr[data-gargs*=TAX')
    //    const payload = Array.from(subtopics).reduce((a, c, i, d) => {
    //        const text = c.querySelector('td').innerText
    //        return { ...a, [`${text.replace(' ', '_')}`]: text }
    //    }, {})
    //    return payload
    //})
    //}, body)
    //console.log({ nodeList })

    browser.close()
}

topicPaginator() //?

const searchPaginator = async (list = 0, progress = []) => {
    console.log('searchPaginator', `list = ${list}`)
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: width, height: height },
    })
    const page = await browser.newPage()
    await page.setViewport({ width: width, height: height })
    await page.goto(url)
    await page.type('[name="$PKMHelpPortal$pKMSearchText"]', 'the')
    await page.click('[data-click="...."]')
    await page.waitForNetworkIdle()
    //page.

    if (list !== 0) {
        await skipFirstPages(page)
    }
    let elementHandles = await page.$$('a.KM_Article_link')

    const parsePage = configParsePage({
        page,
        elementHandles,
        browser,
        list,
        progress,
    })

    const candidates = await parsePage(elementHandles)

    const content = candidates.filter((x) => !!x)
    //  const res = await Promise.all(elements);
    console.log('Done with list', list)
    browser.close()
    fs.writeFileSync(
        `./json-results/list-${list}.json`,
        JSON.stringify(content, null, 2),
        'utf-8'
    )
    //  console.log(screenshot);
}

const getAllPages = async () => {
    try {
        await [0 /*,1 */].reduce(async (a, c) => {
            const acc = await a
            const content = await searchPaginator(c, acc)
            return acc.concat(content)
        }, Promise.resolve([]))
    } catch (error) {
        console.log(error)
    }
}

const getAndSaveAllPages = async () => {
    const allPagesContent = await getAllPages()
    fs.writeFileSync(
        './json-results/close3.json',
        JSON.stringify(allPagesContent, null, 2),
        'utf-8'
    )
}

//getAllPages() //?
