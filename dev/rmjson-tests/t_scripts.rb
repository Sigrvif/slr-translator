$LOAD_PATH.unshift(File.expand_path("../../www/php/plugins/rmvxace/bin", __dir__))
require "model"
require "scripts"

def t_scripts
  Dir.mktmpdir("scripts") do |d|
    text = "# hello\nputs 'こんにちは'\n"
    zipped = Zlib::Deflate.deflate(text)
    data = [[7, "Vocab", zipped], [8, "Main", zipped]]
    assert(Scripts.data?(data), "triplet array detected as Scripts")
    assert(!Scripts.data?([[1, 2], [3, 4]]), "pair array is not Scripts")
    assert(!Scripts.data?({}), "hash is not Scripts")

    entries = Scripts.dump_entries(data, d)
    assert_eq(2, entries.length, "two entries")
    assert_eq("Script", entries[0]["json_class"], "json_class Script")
    assert_eq(File.join(d, "Script000.rb"), entries[0]["filename"], "filename pattern")
    assert(File.file?(File.join(d, "Script000.rb")), "control file written")
    assert_eq(text, File.read(File.join(d, "Script000.rb")), "control content")
    assert_eq(text, File.read(File.join(d, "Script001_tran.rb")), "tran sidecar copy")
    assert_eq("Vocab", entries[0]["name"]["original   "], "script name as TS")
    assert_eq("", entries[0]["name"]["translation"], "TS translation empty")

    # apply: name translated, sidecar used, control mismatch caught
    j0 = entries[0].dup
    j0["name"] = { "json_class" => "TranslatableString", "original   " => "Vocab", "translation" => "ボキャブ" }
    File.write(File.join(d, "Script000_tran.rb"), "# translated\n")
    out = Scripts.apply_triplet(data[0], j0)
    assert_eq("ボキャブ", out[1], "script name translated")
    assert_eq("# translated\n", Zlib::Inflate.inflate(out[2]), "sidecar text used")
    assert_eq(7, out[0], "magic preserved")

    # missing sidecar -> untranslated text (old tool crashed)
    j1 = entries[1]
    File.delete(File.join(d, "Script001_tran.rb"))
    out1 = Scripts.apply_triplet(data[1], j1)
    assert_eq(text, Zlib::Inflate.inflate(out1[2]).force_encoding("UTF-8"), "missing sidecar keeps original text")

    # control mismatch -> ScriptError raised
    File.write(File.join(d, "Script001.rb"), "# changed\n")
    begin
      Scripts.apply_triplet(data[1], j1)
      assert(false, "control mismatch must raise")
    rescue Scripts::ScriptControlMismatch
      assert(true, "control mismatch raises ScriptControlMismatch")
    end
  end
end
t_scripts
