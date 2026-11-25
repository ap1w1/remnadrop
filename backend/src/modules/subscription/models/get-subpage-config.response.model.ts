export class GetSubpageConfigResponseModel {
    public readonly subpageConfigUuid: string | null;
    public readonly webpageAllowed: boolean;
    public readonly resolvedLinks: {
        supportUrl: string;
        telegramChannel: string;
        telegramBot: string;
        webPage: string;
        webPageStub: string;
    } | null;

    constructor(data: GetSubpageConfigResponseModel) {
        this.subpageConfigUuid = data.subpageConfigUuid;
        this.webpageAllowed = data.webpageAllowed;
        this.resolvedLinks = data.resolvedLinks;
    }
}
