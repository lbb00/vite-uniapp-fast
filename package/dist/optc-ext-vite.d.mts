declare function loadEasycomConfig(inputDir: any): {
    autoscan: boolean;
    custom: any;
};
declare function extractTemplateComponentTags(vueRaw: any): Set<unknown>;
/**
 * Resolve an easycom tag to an absolute .vue path (autoscan components/ + custom rules).
 * Custom targets may point outside inputDir (e.g. @dcloudio/uni-ui).
 */
declare function resolveEasycomTag(tag: any, inputDir: any, easycom: any, aliases?: any[]): any;
/**
 * Seed easycom-only component files into page fingerprints + reverseDeps so
 * integrity and shared-change gates see them (close R2/c17 gap).
 */
declare function seedEasycomIntoFingerprints(inputDir: any, fingerprints: any, reverseDeps: any, aliases?: any[]): {
    edgeCount: number;
    fileCount: number;
    externalPaths: any[];
    easycom: {
        autoscan: boolean;
        custom: any;
    };
};

/**
 * @param {{ inputDir?: string, outDir?: string, aliases?: Record<string,string> }} [opts]
 */
declare function createOptCExtPlugin(opts?: {}): {
    name: string;
    enforce: string;
    configResolved(config: any): void;
    options(rollupOptions: any): any;
    buildStart(): void;
    watchChange(id: any): void;
    generateBundle(): void;
    writeBundle(): void;
    closeBundle: {
        order: string;
        sequential: boolean;
        handler(): void;
    };
};

export { createOptCExtPlugin, extractTemplateComponentTags, loadEasycomConfig, resolveEasycomTag, seedEasycomIntoFingerprints };
