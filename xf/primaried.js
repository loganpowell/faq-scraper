import { readFileSync, write, writeFileSync } from 'fs'

const json = readFileSync('./json-results/topics.json')

const data = JSON.parse(json)

//console.log({ data }) //?

const set = new Set()

const xfd = data.map(({ folderMetadata, content, ...rest }) => {
    const { title, markUpText } = content
    const isPrimary = !set.has(title)
    set.add(title)
    return {
        ...rest,
        content: { title, markUpText },
        folderMetadata: { ...folderMetadata, isPrimary },
    }
})

writeFileSync('./json-results/topics_xf.json', JSON.stringify(xfd, null, 2))
