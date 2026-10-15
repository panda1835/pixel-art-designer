import HomeClient from "@/app/_components/home-client";
import { site } from "@/lib/site";

const application = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: site.name,
  url: site.url,
  description: site.description,
  applicationCategory: "DesignApplication",
  operatingSystem: "Any",
  browserRequirements: "Requires JavaScript and a modern web browser.",
  featureList: [
    "Custom pixel art grids and color palettes",
    "1x1 plates, square tiles, and round tiles",
    "PNG image export",
    "CSV parts list export",
    "Step-by-step building instructions in HTML and JSON",
    "Local project saving and portable project import and export",
  ],
};

export default function Page() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(application).replace(/</g, "\\u003c"),
        }}
      />
      <HomeClient />

    </>
  );
}
