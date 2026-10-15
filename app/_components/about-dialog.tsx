"use client";

import { useRef } from "react";

export default function AboutDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="cursor-pointer justify-self-start rounded-xs border-0 bg-transparent p-0 text-left text-[0.82rem] text-[#0f766e] underline underline-offset-3 transition-[background-color] duration-120 ease-[ease] hover:bg-transparent hover:text-[#115e59]"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        About
      </button>
      <dialog
        ref={dialogRef}
        className="m-auto max-h-[calc(100dvh-48px)] w-[min(600px,calc(100vw-32px))] rounded-[20px] border border-[#cbd5c1] bg-[#f7f2e7] p-0 text-[#1c1917] shadow-[0_24px_80px_rgb(28_25_23/24%)] backdrop:bg-[rgb(28_25_23/45%)] backdrop:backdrop-blur-xs"
        aria-labelledby="about-title"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="p-7">
          <header className="flex items-center justify-between gap-4 border-b border-[#cbd5c1] pb-4">
            <h2 className="text-[0.94rem] tracking-[0.08em] text-[#57534e] uppercase" id="about-title">About us</h2>
            <button
              type="button"
              className="grid h-9 w-9 cursor-pointer place-items-center rounded-lg border border-transparent bg-transparent p-0 text-[1.75rem] leading-none text-[#57534e] transition-[background-color] duration-120 ease-[ease] hover:bg-transparent hover:text-[#1c1917]"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close about us"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="grid gap-4 pt-6 leading-[1.65]">
            <h3 className="text-xl leading-[1.35] font-semibold tracking-normal text-[#1c1917] normal-case">Create pixel art and brick mosaics online</h3>
            <p>
              Pixel Art Designer is a browser-based editor for planning tile art
              and brick mosaics. Choose a custom grid size, paint with your own
              color palette, and build patterns with 1x1 plates, square tiles,
              or round tiles.
            </p>
            <h4 className="mt-2 -mb-2 text-base leading-[1.4] font-semibold">Plan your build</h4>
            <ol className="m-0 list-decimal pl-6">
              <li className="mt-0">
                Create a project and choose the width and height of your grid.
              </li>
              <li className="mt-1.5">
                Select a color and part type, then paint your design on the
                grid.
              </li>
              <li className="mt-1.5">
                Export a PNG preview, a CSV parts list, and step-by-step
                building instructions in HTML or JSON.
              </li>
            </ol>
            <h4 className="mt-2 -mb-2 text-base leading-[1.4] font-semibold">Save your work</h4>
            <p>
              Projects are saved in your browser. Export a portable project file
              to back up your work or import it on another device. Keep a backup
              before clearing browser data.
            </p>
          </div>
        </div>
      </dialog>
    </>
  );
}
