"use client";

import { useRef } from "react";

export default function AboutDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        className="about-link"
        aria-haspopup="dialog"
        onClick={() => dialogRef.current?.showModal()}
      >
        About
      </button>
      <dialog
        ref={dialogRef}
        className="about-dialog"
        aria-labelledby="about-title"
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) dialogRef.current?.close();
        }}
      >
        <div className="about-content">
          <header className="about-header">
            <h2 id="about-title">About us</h2>
            <button
              type="button"
              className="about-close"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close about us"
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="designer-guide">
            <h3>Create pixel art and brick mosaics online</h3>
            <p>
              Pixel Art Designer is a browser-based editor for planning tile art
              and brick mosaics. Choose a custom grid size, paint with your own
              color palette, and build patterns with 1x1 plates, square tiles,
              or round tiles.
            </p>
            <h4>Plan your build</h4>
            <ol>
              <li>
                Create a project and choose the width and height of your grid.
              </li>
              <li>
                Select a color and part type, then paint your design on the
                grid.
              </li>
              <li>
                Export a PNG preview, a CSV parts list, and step-by-step
                building instructions in HTML or JSON.
              </li>
            </ol>
            <h4>Save your work</h4>
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
