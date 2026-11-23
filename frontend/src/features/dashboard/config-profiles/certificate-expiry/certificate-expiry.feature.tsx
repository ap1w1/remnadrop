import type { editor } from "monaco-editor";
import type { Monaco } from "@monaco-editor/react";
import type { ReactNode, RefObject } from "react";

import { Text, TextInput, Tooltip, type TextInputProps } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";

import { instance } from "@shared/api/axios";
import { type Certificate, SSL_API } from "@shared/api/panel-events";

import {
  certificateExpiryText,
  certificateMatchesInValue,
  jsonCertificateDomainAtOffset,
  matchingCertificates,
} from "./certificate-expiry.utils";

const emptyCertificates: Certificate[] = [];
const CertificateExpiryContext = createContext({
  certificates: emptyCertificates,
  nodeUuids: [] as string[],
  locale: "ru",
});

export function useCertificateExpiryRegistry() {
  return useQuery({
    queryKey: ["ssl-certificates"],
    queryFn: async () =>
      (await instance.get<{ response: { items: Certificate[] } }>(SSL_API)).data
        .response.items,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

export function CertificateExpiryProvider({
  children,
  certificates = emptyCertificates,
  nodeUuids,
  locale,
}: {
  children: ReactNode;
  certificates: Certificate[] | undefined;
  nodeUuids: string[];
  locale: string;
}) {
  const value = useMemo(
    () => ({ certificates, nodeUuids, locale }),
    [certificates, nodeUuids, locale],
  );
  return (
    <CertificateExpiryContext.Provider value={value}>
      {children}
    </CertificateExpiryContext.Provider>
  );
}

/** Works on mouse hover, keyboard focus and touch without changing the input value. */
export function CertificateDomainInput(
  props: TextInputProps & { value: string },
) {
  const { certificates, nodeUuids, locale } = useContext(
    CertificateExpiryContext,
  );
  const matches = useMemo(
    () => certificateMatchesInValue(props.value, certificates, nodeUuids),
    [props.value, certificates, nodeUuids],
  );
  return (
    <Tooltip
      disabled={!matches.length}
      events={{ hover: true, focus: true, touch: true }}
      label={
        matches.length ? (
          <Text
            component="span"
            size="xs"
            style={{ whiteSpace: "pre-line", overflowWrap: "anywhere" }}
          >
            {certificateExpiryText(matches, locale)}
          </Text>
        ) : (
          ""
        )
      }
      maw="calc(100vw - 2rem)"
      multiline
      openDelay={250}
      w={380}
      withArrow
    >
      <TextInput {...props} />
    </Tooltip>
  );
}

export function useCertificateExpiryMonacoHover(
  monaco: Monaco | null,
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  certificates: Certificate[] | undefined,
  nodeUuids: string[],
  locale: string,
) {
  useEffect(() => {
    if (!monaco || !certificates?.length) return;
    const provider = monaco.languages.registerHoverProvider("json", {
      provideHover(model, position) {
        if (model !== editorRef.current?.getModel()) return null;
        const domain = jsonCertificateDomainAtOffset(
          model.getValue(),
          model.getOffsetAt(position),
        );
        if (!domain) return null;
        const matches = matchingCertificates(
          domain.domain,
          certificates,
          nodeUuids,
        ).map((certificate) => ({ domain: domain.domain, certificate }));
        if (!matches.length) return null;
        const start = model.getPositionAt(domain.offset);
        const end = model.getPositionAt(domain.offset + domain.length);
        // Calendar names are user data, not trusted Markdown or commands.
        const value = certificateExpiryText(matches, locale)
          .replace(/[\\`*_{}[\]()#+.!|>\-]/g, "\\$&")
          .replace(/\n/g, "  \n");
        return {
          range: new monaco.Range(
            start.lineNumber,
            start.column,
            end.lineNumber,
            end.column,
          ),
          contents: [{ value, isTrusted: false, supportHtml: false }],
        };
      },
    });
    return () => provider.dispose();
  }, [monaco, editorRef, certificates, nodeUuids, locale]);
}
