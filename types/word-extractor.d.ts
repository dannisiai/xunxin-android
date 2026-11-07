declare module "word-extractor" {
    export default class WordExtractor {
        extract(source: Buffer): Promise<{
            getBody(): string;
            getFootnotes(): string;
            getEndnotes(): string;
        }>;
    }
}
