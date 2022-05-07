//import { JSDOM } from 'jsdom'
//import fetch from 'node-fetch'
import puppeteer from 'puppeteer'
import TurndownService from 'turndown'
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
const fetchArticle = async (page, qLink, acc, i, PAGE) => {
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

        return acc.concat({ questionText, answerMD, PAGE, i })
    } catch (err) {
        console.log({ PAGE, i, err })
        return acc.concat({ PAGE, i })
    }
}

;(async () => {
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

    let elementHandles = await page.$$('a.KM_Article_link')

    let progress = []

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
                            PAGE
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
            return progress
        }
    }

    const candidates = await parsePage(elementHandles)

    const content = candidates.filter((x) => !!x)
    //  const res = await Promise.all(elements);
    console.log({ content })
    browser.close()
    //  console.log(screenshot);
})() //?
