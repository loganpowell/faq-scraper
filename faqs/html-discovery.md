faq question link:

```js
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
```

handles:

```js
let table = document.querySelector("[node_name='TaxonomyListTree']")

let topics = table.querySelectorAll("[node_name='TaxonomyListTreeInner']")

topics[0].querySelector('.content-inner').innerText // topic name

// unwraps faq subtopic menus (async)
Array.from(topics).map((topic) => topic.click())

// await network idle + 1000 ms (this takes a while... test)

// for each topic, get subtopics
let subtopics_0 = topics[0].querySelectorAll('tr[data-gargs*=TAX')

// each of these contains their name as `outerText` (e.g., `outerText: "2000 Census")

let subtopic_0_0 = subtopics_0[0]

subtopic_0_0.querySelector('td').innerText // subtopic name

// click on target cell
subtopic_0_0.querySelector('td').click() // => loads FAQs
```
