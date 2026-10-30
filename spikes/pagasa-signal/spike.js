"use strict"

const fs = require("node:fs/promises")
const os = require("node:os")
const path = require("node:path")
const pdfParse = require("pdf-parse")
const { PagasaScraper } = require("pagasa-archiver")
const PDFSourceModule = require("@pagasa-parser/source-pdf")

const PagasaParserPDFSource = PDFSourceModule.default || PDFSourceModule

const PUBFILES_INDEX = "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/"
const HISTORICAL_TINO = {
    label: "Archived Tino bulletin (10, 03 November 2025)",
    file: "PAGASA_25-TC20_Tino_TCB#10.pdf",
    url: "https://raw.githubusercontent.com/pagasa-parser/bulletin-archive/master/archive/pagasa-25-TC20/PAGASA_25-TC20_Tino_TCB%2310.pdf",
}
const USER_AGENT = "BagyoAlerto PAGASA signal feasibility spike/0.1 (single-run, read-only)"
const LANDMASS_NAMES = { 0: "Luzon", 1: "Visayas", 2: "Mindanao" }
const TARGETS = [
    { label: "Surigao del Norte", pattern: /\bsurigao\s+del\s+norte\b/i },
    { label: "Siargao", pattern: /\bsiargao\b/i },
    { label: "Bucas Grande Islands", pattern: /\bbucas\s*(?:-|\s)\s*grande\s+islands?\b/i },
]

function cleanText(value) {
    return String(value || "")
        .replace(/[“”]/g, '"')
        .replace(/\uFFFD/g, "")
        .replace(/\s+/g, " ")
        .trim()
}

function parsePhtDate(value) {
    const parsed = new Date(`${cleanText(value)} GMT+0800`)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

function parseBulletinFilename(file) {
    const match = /^TCB#(\d+)([A-Z])?(?:-?(?:F|FINAL))?[_ -]+(.+?)\.pdf$/i.exec(file)
    if (!match) return null

    return {
        bulletinNumber: `${match[1]}${match[2] || ""}`,
        stormName: match[3],
    }
}

async function listLatestPubfiles(limit = 10) {
    const response = await fetch(PUBFILES_INDEX, {
        headers: { "user-agent": USER_AGENT },
    })
    if (!response.ok) {
        throw new Error(`PAGASA index returned HTTP ${response.status}`)
    }

    const html = await response.text()
    const rows = []
    const rowPattern = /<a\s+href="([^"]+)">([^<]+)<\/a>\s+(\d{2}-[A-Za-z]{3}-\d{4}\s+\d{2}:\d{2})\s+(\S+)/gi
    let match

    while ((match = rowPattern.exec(html)) !== null) {
        const file = cleanText(match[2])
        const filenameInfo = parseBulletinFilename(file)
        if (!filenameInfo) continue

        const modifiedLabel = match[3]
        const modifiedTime = Date.parse(`${modifiedLabel} UTC`)
        rows.push({
            file,
            href: new URL(match[1], PUBFILES_INDEX).toString(),
            modifiedLabel,
            modifiedTime: Number.isNaN(modifiedTime) ? 0 : modifiedTime,
            size: match[4],
            ...filenameInfo,
        })
    }

    rows.sort((left, right) => right.modifiedTime - left.modifiedTime)
    return rows.slice(0, limit)
}

async function downloadLatestBulletin(file) {
    const response = await PagasaScraper.downloadTCB(file, {
        indexURL: PUBFILES_INDEX,
        responseType: "arraybuffer",
        timeout: 30_000,
        headers: { "User-Agent": USER_AGENT },
    })
    return Buffer.from(response.data)
}

async function downloadUrl(url) {
    const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT },
    })
    if (!response.ok) {
        throw new Error(`Download returned HTTP ${response.status}: ${url}`)
    }
    return Buffer.from(await response.arrayBuffer())
}

function assertPdf(buffer, source) {
    if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new Error(`Expected a PDF but received another format from ${source}`)
    }
}

function parseTextMetadata(text) {
    const header = /TROPICAL CYCLONE BULLETIN\s+N(?:R|O)\.?\s*([0-9]+[A-Z]?)\s*\n\s*([^\r\n]+)/i.exec(text)
    const issue = /Issued(?:\s+at)?\s+([^\r\n]+)/i.exec(text)
    const stormLine = cleanText(header?.[2])
    const stormName = stormLine
        .replace(/^(?:Tropical Depression|Tropical Storm|Severe Tropical Storm|Typhoon|Super Typhoon)\s+/i, "")
        .replace(/\s*\([^)]*\)\s*$/, "")
        .replace(/["']/g, "")
        .trim()

    return {
        stormName: stormName || "Unknown",
        bulletinNumber: header?.[1] || "Unknown",
        issueTimeRaw: cleanText(issue?.[1]) || "Unknown",
        issuedAt: issue?.[1] ? parsePhtDate(issue[1]) : null,
        final: /F$/i.test(header?.[1] || "") || /this is the final bulletin/i.test(text),
    }
}

function extractTextSignalBlocks(text) {
    if (/No Wind Signal is currently hoisted/i.test(text)) return []

    const blocks = []
    const sectionPattern = /TROPICAL CYCLONE WIND SIGNALS \(TCWS\) IN EFFECT([\s\S]*?)(?=\n\s*TROPICAL CYCLONE BULLETIN\s+N(?:R|O)\.|\n\s*OTHER HAZARDS|\n\s*HAZARDS AFFECTING|\n\s*Considering these developments|\n\s*DOST-PAGASA|$)/gi
    let sectionMatch

    while ((sectionMatch = sectionPattern.exec(text)) !== null) {
        const section = sectionMatch[1]
        const signalPattern = /(?:^|\n)\s*([1-5])\s*\n\s*Wind threat:\s*\n[\s\S]{0,120}?\bwinds(?:\s+s)?\s*\n([\s\S]*?)\n\s*Warning lead time:/gi
        let signalMatch

        while ((signalMatch = signalPattern.exec(section)) !== null) {
            blocks.push({
                level: Number(signalMatch[1]),
                text: cleanText(signalMatch[2]),
            })
        }
    }

    return blocks.sort((left, right) => right.level - left.level)
}

function formatArea(area) {
    if (!area) return "Unknown area"

    const includes = area.includes
    let description = cleanText(area.name)

    if (includes?.type === "section") {
        description = `${cleanText(includes.part)} ${cleanText(includes.term)} of ${description}`
    } else if (includes?.type === "rest") {
        description = `rest of ${description}`
    } else if (includes?.type === "mainland") {
        description = `mainland ${description}`
    }

    if (Array.isArray(includes?.objects) && includes.objects.length > 0) {
        description += ` (${includes.objects.map(cleanText).join(", ")})`
    }

    if (Array.isArray(area.islands) && area.islands.length > 0) {
        description += ` including ${area.islands.map((island) => cleanText(island.name)).join(", ")}`
    }

    return description
}

function normalizeStructuredSignals(signals) {
    const normalized = []

    for (let level = 5; level >= 1; level -= 1) {
        const signal = signals?.[level]
        if (!signal?.areas) continue

        const areas = []
        for (const [landmassId, entries] of Object.entries(signal.areas)) {
            for (const area of entries || []) {
                areas.push({
                    landmass: LANDMASS_NAMES[landmassId] || `Landmass ${landmassId}`,
                    description: formatArea(area),
                    raw: area,
                })
            }
        }

        normalized.push({ level, areas })
    }

    return normalized
}

function groupTextSignals(blocks) {
    const grouped = new Map()
    for (const block of blocks) {
        if (!grouped.has(block.level)) grouped.set(block.level, [])
        grouped.get(block.level).push(block.text)
    }
    return [...grouped.entries()]
        .sort(([left], [right]) => right - left)
        .map(([level, texts]) => ({
            level,
            areas: texts.map((text) => ({ landmass: "Combined PDF table text", description: text })),
        }))
}

function computeActive({ active, final, issuedAt, expires }) {
    if (typeof active === "boolean") return active
    if (final) return false

    const now = Date.now()
    const issued = issuedAt instanceof Date ? issuedAt.getTime() : NaN
    const expiry = expires instanceof Date ? expires.getTime() : NaN

    if (!Number.isNaN(expiry)) return issued <= now && now < expiry
    if (!Number.isNaN(issued)) return issued <= now && now - issued < 12 * 60 * 60 * 1000
    return false
}

async function parseBulletin(buffer, filename) {
    const tempDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "bagyo-alerto-pagasa-"))
    const pdfPath = path.join(tempDirectory, filename.replace(/[^a-z0-9_.-]/gi, "_"))
    let source
    let parserError
    let parsed

    try {
        await fs.writeFile(pdfPath, buffer)
        source = new PagasaParserPDFSource(pdfPath)

        try {
            parsed = await source.parse()
        } catch (error) {
            parserError = error
        }

        let text = ""
        let textError
        try {
            text = (await pdfParse(buffer)).text
        } catch (error) {
            textError = error
        }

        if (parsed) {
            const textBlocks = text ? extractTextSignalBlocks(text) : []
            return {
                approach: "pagasa-parser with @pagasa-parser/source-pdf",
                stormName: cleanText(parsed.cyclone?.name) || "Unknown",
                bulletinNumber: String(parsed.info?.count ?? "Unknown"),
                issueTimeRaw: parsed.info?.issued instanceof Date ? parsed.info.issued.toISOString() : "Unknown",
                issuedAt: parsed.info?.issued || null,
                final: Boolean(parsed.info?.final),
                active: computeActive(parsed),
                signals: normalizeStructuredSignals(parsed.signals),
                textSignalBlocks: textBlocks,
                parserError: null,
                textError,
            }
        }

        if (!text) {
            throw new AggregateError(
                [parserError, textError].filter(Boolean),
                "Both pagasa-parser and PDF text extraction failed"
            )
        }

        const metadata = parseTextMetadata(text)
        const textSignalBlocks = extractTextSignalBlocks(text)
        let structuredInfo
        let structuredSignals
        let salvageError

        try {
            const [stream, lattice] = source.tabulaStreamData && source.tabulaLatticeData
                ? [source.tabulaStreamData, source.tabulaLatticeData]
                : await source.getTabulaData()
            structuredInfo = source.extractInfo(stream, lattice)
            structuredSignals = source.extractSignals(stream, lattice)
        } catch (error) {
            salvageError = error
        }

        const signals = structuredSignals
            ? normalizeStructuredSignals(structuredSignals)
            : groupTextSignals(textSignalBlocks)

        return {
            approach: structuredSignals
                ? "PDF text/regex fallback with Tabula signal-table salvage"
                : "PDF text/regex fallback",
            ...metadata,
            issuedAt: structuredInfo?.issued || metadata.issuedAt,
            final: structuredInfo?.final ?? metadata.final,
            active: computeActive({
                final: structuredInfo?.final ?? metadata.final,
                issuedAt: structuredInfo?.issued || metadata.issuedAt,
                expires: structuredInfo?.expires,
            }),
            signals,
            textSignalBlocks,
            parserError,
            salvageError,
        }
    } finally {
        await fs.rm(tempDirectory, { recursive: true, force: true })
    }
}

function findTargetCoverage(result, target) {
    const levels = new Set()

    for (const signal of result.signals) {
        for (const area of signal.areas) {
            const candidates = [area.description]
            if (area.raw) {
                candidates.push(area.raw.name)
                candidates.push(...(area.raw.islands || []).map((island) => island.name))
            }
            if (candidates.some((candidate) => target.pattern.test(cleanText(candidate)))) {
                levels.add(signal.level)
            }
        }
    }

    // Validate target names against text limited to the TCWS table. This catches
    // parser tokenization such as "Bucas Island" + "Grande Island".
    for (const block of result.textSignalBlocks) {
        if (target.pattern.test(block.text)) levels.add(block.level)
    }

    return [...levels].sort((left, right) => right - left)
}

function printBulletin(result, source) {
    console.log(`\n${"=".repeat(80)}`)
    console.log(source)
    console.log(`${"=".repeat(80)}`)
    console.log(`Approach: ${result.approach}`)
    if (result.parserError) {
        console.log(`pagasa-parser failure: ${cleanText(result.parserError.message)}`)
    }
    if (result.salvageError) {
        console.log(`Tabula signal salvage failure: ${cleanText(result.salvageError.message)}`)
    }
    console.log(`Storm name: ${result.stormName}`)
    console.log(`Bulletin number: ${result.bulletinNumber}`)
    console.log(`Issue time: ${result.issueTimeRaw}`)
    console.log(`Active tropical cyclone bulletin: ${result.active ? "yes" : "no"}`)

    console.log("\nSignal levels per area:")
    if (result.signals.length === 0) {
        console.log("  none")
    } else {
        for (const signal of result.signals) {
            console.log(`  Signal ${signal.level}`)
            const byLandmass = new Map()
            for (const area of signal.areas) {
                if (!byLandmass.has(area.landmass)) byLandmass.set(area.landmass, [])
                byLandmass.get(area.landmass).push(area.description)
            }
            for (const [landmass, areas] of byLandmass) {
                console.log(`    ${landmass}: ${areas.length > 0 ? areas.join("; ") : "none"}`)
            }
        }
    }

    console.log("\nSurigao-area signal check:")
    for (const target of TARGETS) {
        const levels = findTargetCoverage(result, target)
        console.log(`  ${target.label}: ${levels.length > 0 ? levels.map((level) => `Signal ${level}`).join(", ") : "none"}`)
    }
}

async function runLatest() {
    console.log("Latest PAGASA Tropical Cyclone Bulletins from pubfiles")
    console.log(`Index: ${PUBFILES_INDEX}`)

    const latest = await listLatestPubfiles(10)
    if (latest.length === 0) {
        console.log("No tropical cyclone bulletins are available in the pubfiles index.")
        console.log("Active tropical cyclone: none")
        return
    }

    for (const [index, bulletin] of latest.entries()) {
        console.log(
            `${String(index + 1).padStart(2, " ")}. ${bulletin.file} | modified ${bulletin.modifiedLabel} | ${bulletin.size}`
        )
    }

    const newest = latest[0]
    console.log(`\nDownloading latest: ${newest.file}`)
    const buffer = await downloadLatestBulletin(newest.file)
    assertPdf(buffer, newest.href)
    const result = await parseBulletin(buffer, newest.file)
    printBulletin(result, `Latest pubfiles bulletin: ${newest.href}`)

    if (!result.active) {
        console.log("\nCurrent status: no active tropical cyclone bulletin (latest available bulletin is expired or final).")
    }
}

async function runHistorical() {
    console.log(`\nDownloading historical sample: ${HISTORICAL_TINO.label}`)
    const buffer = await downloadUrl(HISTORICAL_TINO.url)
    assertPdf(buffer, HISTORICAL_TINO.url)
    const result = await parseBulletin(buffer, HISTORICAL_TINO.file)
    printBulletin(result, `${HISTORICAL_TINO.label}: ${HISTORICAL_TINO.url}`)
}

async function main() {
    try {
        await runLatest()
    } catch (error) {
        console.error(`Latest bulletin check failed without crashing the spike: ${cleanText(error.message)}`)
    }

    try {
        await runHistorical()
    } catch (error) {
        console.error(`Historical bulletin check failed: ${cleanText(error.message)}`)
        process.exitCode = 1
    }
}

main()
