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
      <section className="designer-guide" aria-labelledby="designer-guide-title">
        <h2 id="designer-guide-title">Create pixel art and brick mosaics online</h2>
        <p>
          Pixel Art Designer is a browser-based editor for planning tile art and
          brick mosaics. Choose a custom grid size, paint with your own color
          palette, and build patterns with 1x1 plates, square tiles, or round tiles.
        </p>
        <h3>From a pixel pattern to a building plan</h3>
        <ol>
          <li>Create a project and choose the width and height of your grid.</li>
          <li>Select a color and part type, then paint your design on the grid.</li>
          <li>
            Export a PNG preview, a CSV parts list, and step-by-step building
            instructions in HTML or JSON.
          </li>
        </ol>
        <h3>Save and continue your designs</h3>
        <p>
          Projects are saved in your browser. Export a portable project file to
          back up your work or import it on another device. Keep a backup before
          clearing browser data.
        </p>
      </section>
    </>
  );
}
