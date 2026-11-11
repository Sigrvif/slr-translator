if (!this.cells[0]) return;
this.cells[1] = this.cells[0];
this.cells[1] = this.cells[1].replaceAll(/^.*([ぁ-んァ-ン一-龯])([ぁ-んァ-ン一-龯]).*$/g, "");
this.cells[1] = this.cells[1].replaceAll(/^.*「.*$/g, "");