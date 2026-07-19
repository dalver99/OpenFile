import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "OpenFile",
    short_name: "OpenFile",
    description: "Private, local-first chess game reviews and training powered by your own Stockfish.",
    start_url: "/games",
    display: "standalone",
    background_color: "#f7f6f2",
    theme_color: "#a12222",
    icons: [
      {
        src: "/brand/openfile-mark.png",
        sizes: "1254x1254",
        type: "image/png",
      },
    ],
  };
}
