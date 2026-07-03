"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const xmldom_1 = require("@xmldom/xmldom");
const docxtemplaterNamespace = require("docxtemplater");
const { DocUtils } = docxtemplaterNamespace;
const MODULE_NAME = "quorumflow/docxtemplater-modern-image-module";
const DEFAULT_IMAGE_EXTENSION = "png";
// EMUs (English Metric Units) conversion
// 1 inch = 914400 EMUs
// 1 pixel at 96 DPI = 914400 / 96 = 9525 EMUs
const EMUS_PER_PIXEL = 9525;
function convertPixelsToEmus(pixels) {
    return Math.round(pixels * EMUS_PER_PIXEL);
}
function normalizeTagKey(value) {
    return value
        .replace(/[\u200B-\u200D\uFEFF]/g, "")
        .trim();
}
function detectImageExtensionFromBuffer(buffer) {
    if (buffer.length < 12)
        return null;
    if (buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a) {
        return "png";
    }
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }
    if (buffer.length >= 6) {
        const signature = buffer.subarray(0, 6).toString("ascii");
        if (signature === "GIF87a" || signature === "GIF89a")
            return "gif";
    }
    if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
        return "bmp";
    }
    if (buffer.length >= 4) {
        const tiffLittleEndian = buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00;
        const tiffBigEndian = buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a;
        if (tiffLittleEndian || tiffBigEndian)
            return "tiff";
    }
    if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "webp";
    }
    return null;
}
function resolveImageContentType(extension) {
    const normalized = extension.toLowerCase();
    if (normalized === "jpg" || normalized === "jpeg")
        return "image/jpeg";
    if (normalized === "svg")
        return "image/svg+xml";
    if (normalized === "tif" || normalized === "tiff")
        return "image/tiff";
    if (normalized === "png")
        return "image/png";
    if (normalized === "gif")
        return "image/gif";
    if (normalized === "bmp")
        return "image/bmp";
    if (normalized === "webp")
        return "image/webp";
    return `image/${normalized}`;
}
class RelationshipManager {
    zip;
    xmlDocuments;
    relsPath;
    relationshipsDocument;
    constructor(zip, filePath, xmlDocuments) {
        this.zip = zip;
        this.xmlDocuments = xmlDocuments;
        this.relsPath = this.computeRelsPath(filePath);
        this.relationshipsDocument = this.ensureRelationshipsDocument();
    }
    addImage(name, data) {
        const uniqueName = this.ensureUniqueName(name);
        const mediaPath = `word/media/${uniqueName}`;
        this.zip.file(mediaPath, data, { binary: true });
        const extension = this.getExtension(uniqueName);
        this.ensureContentType(extension);
        const nextRid = this.getNextRelationshipId();
        this.appendRelationshipNode(nextRid, uniqueName);
        return nextRid;
    }
    ensureRelationshipsDocument() {
        const existing = this.xmlDocuments[this.relsPath];
        if (existing) {
            return existing;
        }
        const cloned = new xmldom_1.DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>', "application/xml");
        this.xmlDocuments[this.relsPath] = cloned;
        return cloned;
    }
    computeRelsPath(filePath) {
        const lastSlash = filePath.lastIndexOf("/");
        const directory = lastSlash >= 0 ? filePath.slice(0, lastSlash) : "";
        const fileName = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath;
        return `${directory}/_rels/${fileName}.rels`;
    }
    ensureUniqueName(original) {
        let attempt = original;
        let counter = 1;
        while (this.zip.file(`word/media/${attempt}`)) {
            const suffix = `(${counter})`;
            const dotIndex = original.lastIndexOf(".");
            if (dotIndex === -1) {
                attempt = `${original}${suffix}`;
            }
            else {
                attempt = `${original.slice(0, dotIndex)}${suffix}${original.slice(dotIndex)}`;
            }
            counter += 1;
        }
        return attempt;
    }
    ensureContentType(extension) {
        const normalizedExtension = extension.toLowerCase();
        const contentTypesDocument = this.xmlDocuments["[Content_Types].xml"];
        if (!contentTypesDocument) {
            throw new Error("Unable to resolve [Content_Types].xml document.");
        }
        const defaults = contentTypesDocument.getElementsByTagName("Default");
        const isRegistered = Array.from({ length: defaults.length }).some((_, index) => {
            const node = defaults.item(index);
            return node?.getAttribute("Extension")?.toLowerCase() === normalizedExtension;
        });
        if (isRegistered) {
            return;
        }
        const typesNode = contentTypesDocument.getElementsByTagName("Types")[0];
        const newDefault = contentTypesDocument.createElement("Default");
        newDefault.setAttribute("Extension", normalizedExtension);
        newDefault.setAttribute("ContentType", resolveImageContentType(normalizedExtension));
        typesNode.appendChild(newDefault);
    }
    getNextRelationshipId() {
        const relationships = this.relationshipsDocument.getElementsByTagName("Relationship");
        let highest = 0;
        for (let index = 0; index < relationships.length; index += 1) {
            const node = relationships.item(index);
            const idValue = node?.getAttribute("Id");
            if (idValue && /^rId\d+$/.test(idValue)) {
                const numeric = Number.parseInt(idValue.slice(3), 10);
                highest = Math.max(highest, numeric);
            }
        }
        return highest + 1;
    }
    appendRelationshipNode(rId, imageName) {
        const relationshipsNode = this.relationshipsDocument.getElementsByTagName("Relationships")[0];
        const relationshipNode = this.relationshipsDocument.createElement("Relationship");
        relationshipNode.setAttribute("Id", `rId${rId}`);
        relationshipNode.setAttribute("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image");
        relationshipNode.setAttribute("Target", `media/${imageName}`);
        relationshipsNode.appendChild(relationshipNode);
    }
    getExtension(fileName) {
        const match = /\.([a-zA-Z0-9]{2,5})(?:$|[?#])/.exec(fileName);
        return match ? match[1].toLowerCase() : DEFAULT_IMAGE_EXTENSION;
    }
}
class ModernImageModule {
    name = "ModernImageModule";
    options;
    imageNumber = 1;
    zip = null;
    xmlDocuments = null;
    fileTypeConfig = null;
    constructor(options) {
        if (!options.getImage) {
            throw new Error("ModernImageModule requires a getImage implementation.");
        }
        if (!options.getSize) {
            throw new Error("ModernImageModule requires a getSize implementation.");
        }
        this.options = {
            centered: options.centered ?? false,
            getImage: options.getImage,
            getSize: options.getSize,
        };
    }
    optionsTransformer(options, docxtemplater) {
        if (!docxtemplater) {
            return options;
        }
        const rels = docxtemplater.zip
            .file(/\.xml\.rels/)
            .map((file) => file.name);
        const contentTypes = docxtemplater.zip
            .file(/\[Content_Types\].xml/)
            .map((file) => file.name);
        const existingNames = Array.isArray(options.xmlFileNames)
            ? options.xmlFileNames
            : [];
        const names = new Set(existingNames);
        rels.concat(contentTypes).forEach((name) => names.add(name));
        this.zip = docxtemplater.zip;
        this.fileTypeConfig = docxtemplater.fileTypeConfig;
        options.xmlFileNames = Array.from(names);
        return options;
    }
    set(options) {
        if (options.zip) {
            this.zip = options.zip;
        }
        if (options.xmlDocuments) {
            this.xmlDocuments = options.xmlDocuments;
        }
    }
    parse(placeHolderContent) {
        if (placeHolderContent.startsWith("%%")) {
            return {
                module: MODULE_NAME,
                type: "placeholder",
                value: normalizeTagKey(placeHolderContent.slice(2)),
                centered: true,
            };
        }
        if (placeHolderContent.startsWith("%")) {
            return {
                module: MODULE_NAME,
                type: "placeholder",
                value: normalizeTagKey(placeHolderContent.slice(1)),
                centered: false,
            };
        }
        return null;
    }
    postparse(parsed) {
        return DocUtils.traits.expandToOne(parsed, {
            moduleName: MODULE_NAME,
            expandTo: this.options.centered ? "w:p" : "w:t",
            getInner: ({ part }) => part,
        });
    }
    render(part, options) {
        if (part.module !== MODULE_NAME) {
            return null;
        }
        if (!options) {
            throw new Error("ModernImageModule requires render options to resolve scope and file information.");
        }
        const value = options.scopeManager.getValue(part.value, { part });
        if (!value) {
            return this.toRendered(this.getFallbackTag());
        }
        const buffer = this.resolveBufferSync(this.options.getImage(value, part.value));
        if (buffer.length === 0) {
            return this.toRendered(this.getFallbackTag());
        }
        const size = this.resolveSizeSync(this.options.getSize(buffer, value, part.value));
        const manager = this.createRelationshipManager(options.filePath);
        const rId = manager.addImage(this.createImageName(value, buffer), buffer);
        const xml = this.renderImageXml(part.centered ?? this.options.centered, rId, size);
        return this.toRendered(xml);
    }
    resolve(part, options) {
        if (part.module !== MODULE_NAME) {
            return null;
        }
        if (!options) {
            throw new Error("ModernImageModule requires resolver options to access scope data.");
        }
        const value = options.scopeManager.getValue(part.value, { part });
        if (!value) {
            return Promise.resolve(this.toRendered(this.getFallbackTag()));
        }
        const manager = this.createRelationshipManager(options.filePath);
        return Promise.resolve(this.options.getImage(value, part.value))
            .then((image) => this.ensureBuffer(image))
            .then((buffer) => {
            if (buffer.length === 0) {
                return this.toRendered(this.getFallbackTag());
            }
            return Promise.resolve(this.options.getSize(buffer, value, part.value)).then((size) => {
                const rId = manager.addImage(this.createImageName(value, buffer), buffer);
                const xml = this.renderImageXml(part.centered ?? this.options.centered, rId, this.normalizeSize(size));
                return this.toRendered(xml);
            });
        });
    }
    createRelationshipManager(filePath) {
        if (!this.zip || !this.xmlDocuments) {
            throw new Error("ModernImageModule has not been initialised with document context.");
        }
        return new RelationshipManager(this.zip, filePath, this.xmlDocuments);
    }
    resolveBufferSync(result) {
        if (result instanceof Promise) {
            throw new TypeError("Asynchronous image sources are not supported in synchronous render path. Use async templates instead.");
        }
        return this.ensureBuffer(result);
    }
    resolveSizeSync(result) {
        if (result instanceof Promise) {
            throw new TypeError("Asynchronous size resolvers are not supported in synchronous render path. Use async templates instead.");
        }
        return this.normalizeSize(result);
    }
    ensureBuffer(value) {
        if (!Buffer.isBuffer(value)) {
            throw new TypeError("ModernImageModule expected getImage to resolve to a Buffer instance.");
        }
        return value;
    }
    normalizeSize(value) {
        const [width, height] = value;
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
            throw new TypeError("ModernImageModule expected getSize to resolve to positive numeric dimensions.");
        }
        return [width, height];
    }
    renderImageXml(centered, rId, sizeInPixels) {
        const [width, height] = sizeInPixels.map((dimension) => convertPixelsToEmus(dimension));
        return this.getParagraphXml(centered, rId, String(width), String(height));
    }
    getDrawingXml(rId, width, height) {
        return `
            <w:drawing>
                <wp:inline distT="0" distB="0" distL="0" distR="0">
                    <wp:extent cx="${width}" cy="${height}"/>
                    <wp:effectExtent l="0" t="0" r="0" b="0"/>
                    <wp:docPr id="${rId}" name="Generated Image" descr="embedded image"/>
                    <wp:cNvGraphicFramePr>
                        <a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/>
                    </wp:cNvGraphicFramePr>
                    <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
                        <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
                            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
                                <pic:nvPicPr>
                                    <pic:cNvPr id="${rId}" name="Generated Image"/>
                                    <pic:cNvPicPr>
                                        <a:picLocks noChangeAspect="1" noChangeArrowheads="1"/>
                                    </pic:cNvPicPr>
                                </pic:nvPicPr>
                                <pic:blipFill>
                                    <a:blip r:embed="rId${rId}"/>
                                    <a:stretch>
                                        <a:fillRect/>
                                    </a:stretch>
                                </pic:blipFill>
                                <pic:spPr bwMode="auto">
                                    <a:xfrm>
                                        <a:off x="0" y="0"/>
                                        <a:ext cx="${width}" cy="${height}"/>
                                    </a:xfrm>
                                    <a:prstGeom prst="rect">
                                        <a:avLst/>
                                    </a:prstGeom>
                                </pic:spPr>
                            </pic:pic>
                        </a:graphicData>
                    </a:graphic>
                </wp:inline>
            </w:drawing>
        `.split(/\s{2,}/).join("");
    }
    getParagraphXml(centered, rId, width, height) {
        const paragraphProperties = centered
            ? `<w:pPr><w:jc w:val="center"/></w:pPr>`
            : "";
        return `
            <w:p>
                ${paragraphProperties}
                <w:r>
                    <w:rPr/>
                    ${this.getDrawingXml(rId, width, height)}
                </w:r>
            </w:p>
        `.split(/\s{2,}/).join("");
    }
    createImageName(tagValue, buffer) {
        const extension = detectImageExtensionFromBuffer(buffer) ?? this.resolveExtension(tagValue);
        const name = `report-image-${this.imageNumber}.${extension}`;
        this.imageNumber += 1;
        return name;
    }
    resolveExtension(tagValue) {
        if (typeof tagValue === "string") {
            const match = /\.([a-zA-Z0-9]{2,5})(?:$|[?#])/.exec(tagValue);
            if (match) {
                return match[1].toLowerCase();
            }
        }
        return DEFAULT_IMAGE_EXTENSION;
    }
    toRendered(value) {
        return { value, errors: [] };
    }
    getFallbackTag() {
        if (!this.fileTypeConfig) {
            throw new Error("ModernImageModule does not have access to file type configuration.");
        }
        return this.fileTypeConfig.tagTextXml;
    }
}
exports.default = ModernImageModule;
//# sourceMappingURL=modern-image-module.js.map