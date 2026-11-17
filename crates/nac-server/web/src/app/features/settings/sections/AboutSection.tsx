import { ButtonSize, ButtonVariant, CopyButton, IconName } from "@/app/atoms";
import { useProductContext } from "@/app/features/product-context/queries";
import { useStoreInfo } from "@/app/services/queries";
import { SettingsGroup, SettingsLinkRow, SettingsRow } from "../SettingsRows";
import { DOCS_URL, REPO_URL } from "../sections";

/** Settings › About: version and build, where the store lives, docs and source. */
export function AboutSection() {
  const { data: storeInfo } = useStoreInfo();
  const product = useProductContext(null, true);
  const storePath = storeInfo?.store_path ?? "";
  const build = product.data?.build;
  return (
    <div className="flex flex-col gap-8">
      <SettingsGroup title="NAC">
        <SettingsRow
          label="Version"
          control={
            <span className="type-body-chrome text-basic-secondary tabular">
              {build
                ? `${build.product_version} · ${build.track}`
                : product.isPending
                  ? "Reading…"
                  : "Unavailable"}
            </span>
          }
        />
        {build ? (
          <>
            <SettingsRow
              label="Build"
              stacked
              control={
                <code className="code-small break-all text-basic-secondary">{build.build_id}</code>
              }
            />
            <SettingsRow
              label="Revision"
              stacked
              control={
                <code className="code-small break-all text-basic-secondary">
                  {build.source_revision}
                </code>
              }
            />
          </>
        ) : null}
      </SettingsGroup>
      <SettingsGroup
        title="Data"
        description="Sessions, projects and saved setups live in this store on the NAC server."
      >
        <SettingsRow
          label="Store"
          stacked
          control={
            <div className="flex min-w-0 items-center gap-2">
              <code
                className="code-small min-w-0 flex-1 truncate text-basic-secondary"
                title={storePath}
              >
                {storePath || "store path pending"}
              </code>
              <CopyButton
                value={storePath}
                size={ButtonSize.Medium}
                variant={ButtonVariant.Ghost}
                title="Copy the store path"
                disabled={!storePath}
              />
            </div>
          }
        />
      </SettingsGroup>
      <SettingsGroup title="Resources">
        <SettingsLinkRow
          label="Documentation"
          hint="Guides and reference"
          href={DOCS_URL}
          icon={IconName.Book}
        />
        <SettingsLinkRow
          label="GitHub"
          hint="Source, issues and releases"
          href={REPO_URL}
          icon={IconName.Github}
        />
      </SettingsGroup>
    </div>
  );
}
