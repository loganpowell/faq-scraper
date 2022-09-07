//import { JSDOM } from 'jsdom'
//import fetch from 'node-fetch'
import puppeteer from 'puppeteer'
import TurndownService from 'turndown'
import fs from 'fs'
const html2MD = TurndownService()

const headers = {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
}

const url =
    'https://ask.census.gov/prweb/PRServletCustom/app/ECORRAsk1_/YACFBFye-rFIz_FoGtyvDRUGg1Uzu5Mn*/!STANDARD'

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

const width = 1024
const height = 2000
//getHtml();

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

        const answerMD = await html2MD.turndown(answerHTML)
        const backLink = await page.$('[data-ctl]')
        backLink.click()
        await page.waitForNetworkIdle()
        //  await page.waitForTimeout(2000);
        if (list !== 0) {
            await skipFirstPages(page)
            await page.waitForNetworkIdle()
        }

        return acc.concat({ questionText, answerMD, PAGE, i })
    } catch (err) {
        console.log({ PAGE, i, err })
        return acc.concat({ PAGE, i })
    }
}

const bigPaginator = async (list = 0, progress = []) => {
    console.log('bigPaginator', `list = ${list}`)
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

    const parsePage = async (elementHandles, PAGE = 0) => {
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
            const content = await bigPaginator(c, acc)
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
