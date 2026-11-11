if (!this.cells[1]) return;
this.cells[1] = this.cells[1].replaceAll(/(.*)(【.+】)(.*)/gi, "$2$1$3");
this.cells[1] = this.cells[1].replaceAll(/  /gi, " ");
