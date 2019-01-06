const bent = require('../bent')
const $ = require('cheerio')
const urlParse = require('url').parse
const qs = require('querystring')
const mkdirp = require('mkdirp')
const path = require('path')
const fs = require('fs')
const sanitize = require('sanitize-filename')

const base = 'https://web.archive.org'
const get = bent('string', base)
const head = bent('HEAD', base, 302, 200, 404)

let template = event => {
  let str = `---\n`
  str += `fromLanyrd: true\n`
  str += `title: "${event.title.replace(/\\([\s\S])|(")/g, "\\$1$2")}"\n`
  str += `location: "${event.location}"\n`
  if (event.url) {
    `url: ${event.url}\n`
  }
  str += `start: ${event.start}\n`
  if (event.end) {
    str += `end: ${event.end}\n`
  }
  if (event.tags.length) {
    str += `tags: ${event.tags.join(', ')}\n`
  }
  if (event.twitter) {
    str += `twitter: "${event.twitter}"\n`
  }
  if (event.hashtag) {
    str += `hashtag: "${event.hashtag}"\n`
  }
  str += `---\n`
  return str
}

const getFilename = event => {
  let dir = path.join(__dirname, 'confs', ...event.start.split('-'))
  mkdirp.sync(dir)
  let title = sanitize(event.title.replace(/\ /g, '_'))
    .replace(/[^\w\.@-]/g, '')
  let f = path.join(dir, `${title}.md`)
  return f
}

const write = event => {
  if (!event.start) {
    return console.error('No start time!')
  }
  let f = getFilename(event)
  console.log('writing', f)
  fs.writeFileSync(f, Buffer.from(template(event)))
}

const fileExists = f => {
  try {
    fs.statSync(f)
  } catch (e) {
    return false
  }
  return true
}

const follow = async url => {
  let resp
  try {
    resp = await head(url)
  } catch (e) {
    console.error('skipping, HEAD error', url)
    return null
  }

  while (resp.statusCode === 302) {
    url = resp.headers.location.slice(base.length)
    try {
      resp = await head(url)
    } catch (e) {
      console.error('skipping, error', url)
      return null
    }
  }
  if (resp.statusCode === 404) {
    return null
  }
  let str
  try {
    str = await get(url)
  } catch (e) {
    console.error('skipping, error', url)
    return null
  }
  return str
}

const start = '/web/20161112004018/http://lanyrd.com/conferences/'

const toArray = nodelist => {
  return Array.from((function * () {
    for (let i = 0; i < nodelist.length; i++) {
      yield nodelist[i]
    }
  })())
}

const clean = event => {
  // TODO: cleanup location and other bits
  let _clean = str => str.replace(/\t/g, '').replace(/\n/g, '')
  event.location = _clean(event.location)
  event.tags = event.tags.map(t => _clean(t))
  let [region, ...rest] = event.location.split(',')
  region = region.slice(region.length / 2)
  event.location = [region, ...rest].join(', ')
  write(event)
}

const scrapeEvent = async (event) => {
  event.tags = []

  if (fileExists(getFilename(event))) {
    return // console.log('skipping', getFilename(event), 'exists.')
  }

  let html = await follow(event.url)
  if (html === null) {
    /* event page is a 404 */
    event.url = undefined
    clean(event)
    return
  }
  let page = $(html)
  page.find('ul.tags li a').each(function () {
    let self = $(this)
    event.tags.push(self.text())
  })
  event.url = page.find('a.website').attr('href')
  if (event.url) {
    event.url = event.url.slice(event.url.lastIndexOf('http'))
  }
  event.twitter = page.find('a.twitter').text()
  event.hashtag = page.find('a.hashtag').text()
  clean(event)
}

const scrapeMonth = async url => {
  console.log('month', url)
  let html = await follow(url)
  let events = []
  $('li.conference', html).each(function () {
    let self = $(this)
    let event = {
      title: self.find('h4 a').text(),
      url: self.find('h4 a').attr('href'),
      location: self.find('p.location').text(),
      start: self.find('abbr.dtstart').attr('title'),
      end: self.find('abbr.dtend').attr('title')
    }
    events.push(event)
  })
  for (let event of events) {
    await scrapeEvent(event)
  }
  let u = urlParse(url)
  let page = 1
  if (u.query) {
    let q = qs.parse(u.query)
    page = parseInt(q.page)
  }
  let next = $('div.pagination ol li a', html).filter(function () {
    let self = $(this)
    let text = self.text()
    if (text === (page + 1).toString()) {
      return true
    }
  }).attr('href')
  if (next) {
    await scrapeMonth(next)
  }
}

const scrapeYear = async url => {
  console.log('year', url)
  let html = await follow(url)
  let months = toArray($('ul.month-summaries a', html))
  let urls = months.map(n => n.attribs.href)
  for (let url of urls) {
    await scrapeMonth(url)
  }
}

const run = async () => {
  let html = await follow(start)
  let years = toArray($('div.primary p a', html))
  let urls = years.map(n => n.attribs.href).slice(8)
  // urls.forEach(url => scrapeYear(url))

  urls = urls.filter(u => {
    let year = u.slice('/web/20180514130000/http://lanyrd.com:80/'.length)
    year = year.slice(0, 4)
    if (year === 'plac') return false
    else year = parseInt(year)
    if (year > 2017) {
      return true
    }
    return false
  })

  let next = () => {
    let year = urls.shift()
    if (year) scrapeYear(year).then(next)
  }
  scrapeYear(urls.shift()).then(next)
  scrapeYear(urls.shift()).then(next)
  scrapeYear(urls.shift()).then(next)
  // for (let url of urls) {
  //   await scrapeYear(url)
  // }
}
run()

// scrapeMonth('/web/20161112004018/http://lanyrd.com:80/2015/jan/')