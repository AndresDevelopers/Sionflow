import type PizZip from "pizzip";
interface ModernImageModuleOptions {
    centered?: boolean;
    getImage: (tagValue: unknown, tagName: string) => Buffer | Promise<Buffer>;
    getSize: (image: Buffer, tagValue: unknown, tagName: string) => [number, number] | Promise<[number, number]>;
}
interface ModulePart {
    module: string;
    type: string;
    value: string;
    centered?: boolean;
}
interface ScopeManager {
    getValue: (key: string, context: {
        part: ModulePart;
    }) => unknown;
}
interface RenderOptions {
    scopeManager: ScopeManager;
    filePath: string;
}
interface ResolverOptions extends RenderOptions {
}
export default class ModernImageModule {
    name: string;
    private readonly options;
    private imageNumber;
    private zip;
    private xmlDocuments;
    private fileTypeConfig;
    constructor(options: ModernImageModuleOptions);
    optionsTransformer(options: any, docxtemplater?: any): any;
    set(options: {
        zip?: PizZip;
        xmlDocuments?: Record<string, any>;
    }): void;
    parse(placeHolderContent: string): ModulePart | null;
    postparse(parsed: unknown): any;
    render(part: ModulePart, options?: RenderOptions): {
        value: string;
        errors: any[];
    } | null;
    resolve(part: ModulePart, options?: ResolverOptions): Promise<{
        value: string;
        errors: any[];
    }> | null;
    private createRelationshipManager;
    private resolveBufferSync;
    private resolveSizeSync;
    private ensureBuffer;
    private normalizeSize;
    private renderImageXml;
    private getDrawingXml;
    private getParagraphXml;
    private createImageName;
    private resolveExtension;
    private toRendered;
    private getFallbackTag;
}
export {};
//# sourceMappingURL=modern-image-module.d.ts.map