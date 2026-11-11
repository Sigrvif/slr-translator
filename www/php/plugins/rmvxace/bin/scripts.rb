# scripts.rb — handling for the Scripts data file: an array of
# [magic, name, zipped_code] triplets. Dump writes each inflated script plus a
# _tran.rb copy; apply verifies the control file against the data and prefers
# the _tran.rb sidecar.
require "zlib"
require "fileutils"

module Scripts
  class ScriptControlMismatch < StandardError; end

  TRAN_SUFFIX = /(\.rb)\z/.freeze

  def self.data?(data)
    data.is_a?(Array) && !data.empty? && data[0].is_a?(Array) && data[0].length == 3
  end

  def self.text_of(triplet)
    Zlib::Inflate.inflate(triplet[2]).force_encoding("UTF-8")
  end

  def self.file_for(dir, index)
    File.join(dir, format("Script%03d.rb", index))
  end

  # Writes sidecars and returns the JSON-ready entries array.
  def self.dump_entries(data, dir)
    FileUtils.mkdir_p(dir)
    data.map.with_index do |triplet, i|
      text = text_of(triplet)
      path = file_for(dir, i)
      File.binwrite(path, text)
      File.binwrite(path.sub(TRAN_SUFFIX, "_tran\\1"), text)
      {
        "json_class" => "Script",
        "filename" => path,
        "name" => dump_string(triplet[1]),
      }
    end
  end

  # Applies one JSON entry to one triplet; returns a new triplet.
  # Raises ScriptControlMismatch when the control file no longer matches the data.
  def self.apply_triplet(triplet, entry)
    name = triplet[1]
    jname = entry["name"]
    name = apply_ts(jname, name) if jname.is_a?(Hash)

    text = text_of(triplet)
    control = entry["filename"]
    if control && File.file?(control)
      ctext = File.binread(control).force_encoding("UTF-8")
      if ctext != text
        raise ScriptControlMismatch,
              "script control file #{control} does not match the data file (data updated or original edited?)"
      end
      tran = control.sub(TRAN_SUFFIX, "_tran\\1")
      text = File.binread(tran).force_encoding("UTF-8") if File.file?(tran)
    end
    [triplet[0], name, Zlib::Deflate.deflate(text)]
  end

  # --- shared JSON helpers (also used by rmjson.rb) ---------------------

  ORIG_KEY = "original   "
  TRAN_KEY = "translation"

  def self.dump_string(str)
    return nil if str.nil?
    {
      "json_class" => "TranslatableString",
      ORIG_KEY => str.dup.force_encoding("UTF-8"),
      TRAN_KEY => "",
    }
  end

  def self.apply_ts(ts, orig)
    got = ts[ORIG_KEY]
    expected = orig.dup.force_encoding("UTF-8")
    if got != expected
      raise "invalid translation element: got #{got.inspect}, expected #{expected.inspect}"
    end
    t = ts[TRAN_KEY]
    (t.nil? || t.empty?) ? orig : t
  end
end
