if (!this.cells[1]) return;
this.cells[1] = this.cells[1].replaceAll(/I'm/g, "I am");
this.cells[1] = this.cells[1].replaceAll(/You're/g, "You are");
this.cells[1] = this.cells[1].replaceAll(/you're/g, "you are");
this.cells[1] = this.cells[1].replaceAll(/e's/g, "e is");
this.cells[1] = this.cells[1].replaceAll(/It's/g, "It is");
this.cells[1] = this.cells[1].replaceAll(/it's/g, "it is");
this.cells[1] = this.cells[1].replaceAll(/They're/g, "They are");
this.cells[1] = this.cells[1].replaceAll(/they're/g, "they are");
this.cells[1] = this.cells[1].replaceAll(/won't/g, "will not");
this.cells[1] = this.cells[1].replaceAll(/n't/g, " not");
this.cells[1] = this.cells[1].replaceAll(/Let's/g, "Let us");
this.cells[1] = this.cells[1].replaceAll(/let's/g, "let us");
this.cells[1] = this.cells[1].replaceAll(/I'll/g, "I will");
this.cells[1] = this.cells[1].replaceAll(/who's/g, "who is");
this.cells[1] = this.cells[1].replaceAll(/Who's/g, "Who is");

this.cells[1] = this.cells[1].replaceAll(/([a-z][ ]?)'([ ]?[a-z])/gi, "$1$2");