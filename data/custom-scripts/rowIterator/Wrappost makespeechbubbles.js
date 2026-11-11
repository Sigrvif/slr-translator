if (this.cells[2]) {
  if (this.cells[2].includes("「") === true) {
    let LinesToLook = this.cells[2].replaceAll("\r", "").split("\n");
    if (LinesToLook.length > 1) {
      let LinesInBlock = false;
      for (let i1 = 0; i1 < LinesToLook.length; i1++) {
        let CurLine = LinesToLook[i1];
        if (LinesInBlock) { LinesToLook[i1] = "　" + LinesToLook[i1].trimStart(); }
        if (CurLine.trimStart().slice(0,1) == "「") { LinesInBlock = true; }
        if (CurLine.trimEnd().slice(-1) == "」") { LinesInBlock = false; }
      }
    this.cells[2] = LinesToLook.join("\n");
    }
  }
}
if (this.cells[2]) {
  if (this.cells[2].includes("『") === true) {
    let LinesToLook = this.cells[2].replaceAll("\r", "").split("\n");
    if (LinesToLook.length > 1) {
      let LinesInBlock = false;
      for (let i1 = 0; i1 < LinesToLook.length; i1++) {
        let CurLine = LinesToLook[i1];
        if (LinesInBlock) { LinesToLook[i1] = "　" + LinesToLook[i1].trimStart(); }
        if (CurLine.trimStart().slice(0,1) == "『") { LinesInBlock = true; }
        if (CurLine.trimEnd().slice(-1) == "』") { LinesInBlock = false; }
      }
    this.cells[2] = LinesToLook.join("\n");
    }
  }
}
if (this.cells[2]) {
  if (this.cells[2].includes("（") === true) {
    let LinesToLook = this.cells[2].replaceAll("\r", "").split("\n");
    if (LinesToLook.length > 1) {
      let LinesInBlock = false;
      for (let i1 = 0; i1 < LinesToLook.length; i1++) {
        let CurLine = LinesToLook[i1];
        if (LinesInBlock) { LinesToLook[i1] = "　" + LinesToLook[i1].trimStart(); }
        if (CurLine.trimStart().slice(0,1) == "（") { LinesInBlock = true; }
        if (CurLine.trimEnd().slice(-1) == "）") { LinesInBlock = false; }
      }
    this.cells[2] = LinesToLook.join("\n");
    }
  }
}
if (this.cells[2]) {
  if (this.cells[2].includes("｢") === true) {
    let LinesToLook = this.cells[2].replaceAll("\r", "").split("\n");
    if (LinesToLook.length > 1) {
      let LinesInBlock = false;
      for (let i1 = 0; i1 < LinesToLook.length; i1++) {
        let CurLine = LinesToLook[i1];
        if (LinesInBlock) { LinesToLook[i1] = "　" + LinesToLook[i1].trimStart(); }
        if (CurLine.trimStart().slice(0,1) == "｢") { LinesInBlock = true; }
        if (CurLine.trimEnd().slice(-1) == "｣") { LinesInBlock = false; }
      }
    this.cells[2] = LinesToLook.join("\n");
    }
  }
}