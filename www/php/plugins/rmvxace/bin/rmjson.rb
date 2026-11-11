#!/usr/bin/env ruby
# rmjson — dumps RPG Maker XP/VX/VXAce data files (.rxdata/.rvdata/.rvdata2)
# to translatable JSON and applies translations back into Marshal data files.
# Clean-room replacement for the app's legacy Ruby translation tool.
#
# Usage:
#   ruby rmjson.rb --dump=<file-or-glob> [--dest=<dir>]
#   ruby rmjson.rb --translate=<file-or-glob> --dest=<dir>
require_relative "model"
require_relative "rules"
require_relative "scripts"
require "json"

ORIG_KEY = Scripts::ORIG_KEY
TRAN_KEY = Scripts::TRAN_KEY

# The legacy tool's XP RPG::System::Words and VX RPG::System::Terms to_json
# methods omitted the "json_class" marker (ace Terms kept it). Mirror that
# per engine for byte-identical dumps; apply_json never reads the marker.
NO_CLASS_MARKER = {
  xp: ["RPG::System::Words"].freeze,
  vx: ["RPG::System::Terms"].freeze,
}.freeze

def error(msg)
  puts "Error: #{msg}"
  exit 1
end

def engine_of(path)
  engine = Rules.engine_for_ext(File.extname(path))
  error("unknown data file extension: #{path}") if engine.nil?
  engine
end

def ivar_sym(key, override)
  (override || "@#{key}").to_s
end

# ---------- translatable JSON primitives ----------

def ts(str)
  Scripts.dump_string(str)
end

def wrap_array(arr)
  arr.map do |e|
    if e.is_a?(String)     then ts(e)
    elsif e.is_a?(Array)   then wrap_array(e)
    else e
    end
  end
end

def apply_ts(j, orig)
  Scripts.apply_ts(j, orig)
end

def apply_ta(j, orig)
  got = j[ORIG_KEY]
  if !got.is_a?(Array) || got.length != orig.length
    error("invalid translation element: list length " \
          "#{got.is_a?(Array) ? got.length : 'unknown'}, expected #{orig.length}")
  end
  got.each_with_index do |g, i|
    e = orig[i].dup.force_encoding("UTF-8")
    error("invalid translation element: got #{g.inspect}, expected #{e.inspect} (index #{i})") if g != e
  end
  tran = j[TRAN_KEY]
  (tran.nil? || tran.all? { |t| t.nil? || t.empty? }) ? orig : tran
end

def apply_wrapped(orig, tran)
  orig.zip(tran).map do |o, t|
    if o.is_a?(String)   then t.nil? ? o : apply_ts(t, o)
    elsif o.is_a?(Array) then t.nil? ? o : apply_wrapped(o, t)
    else o
    end
  end
end

# ---------- event commands ----------

def cmd_code(c)   c.instance_variable_get(:@code) end
def cmd_indent(c) c.instance_variable_get(:@indent) end
def cmd_params(c) c.instance_variable_get(:@parameters) end

def make_cmd(klass, code, indent, params)
  obj = klass.allocate
  obj.instance_variable_set(:@code, code)
  obj.instance_variable_set(:@indent, indent)
  obj.instance_variable_set(:@parameters, params)
  obj
end

def event_type(engine, code, params)
  entry = EventCodes.for(engine)[code]
  return [code, false] if entry.nil?
  # Legacy quirk (fixed): control variables (122) whose operand type (params[3])
  # is 4 embed a script string — translatable. Evaluated per command; the legacy
  # tool mutated its shared table instead, leaking the flag to later 122s.
  if engine == :ace && code == 122 && params[3] == 4
    return [entry[0], true]
  end
  entry
end

# merge_commands folds continuation runs (401/408/655...) into single
# commands with concatenated params. When `runs` is given, it records
# merged head object id -> original run commands, so split_commands can reuse
# the original objects instead of allocating fresh ones: modded games attach
# extra ivars (e.g. @features on RPG::EventCommand) that fresh objects would
# drop, breaking byte-identical round-trips.
def merge_commands(list, engine, runs = nil)
  cont = Rules::MERGE_CONT[engine]
  out = []
  i = 0
  while i < list.length
    cmd = list[i]
    c = cont[cmd_code(cmd)]
    if c && list[i + 1] && cmd_code(list[i + 1]) == c
      run = [cmd]
      params = (cmd_params(cmd) || []).dup
      while list[i + 1] && cmd_code(list[i + 1]) == c
        i += 1
        run.push(list[i])
        params.concat(cmd_params(list[i]) || [])
      end
      cmd = make_cmd(cmd.class, cmd_code(cmd), cmd_indent(cmd), params)
      runs[cmd.object_id] = run if runs
    end
    out.push(cmd)
    i += 1
  end
  out
end

def split_commands(list, engine, runs = nil)
  cont = Rules::MERGE_CONT[engine]
  out = []
  list.each do |cmd|
    c = cont[cmd_code(cmd)]
    params = cmd_params(cmd) || []
    if c && params.length > 1
      code = cmd_code(cmd)
      # A lone multi-param command straight from the data (no recorded run)
      # reuses itself for the first piece so its extra ivars survive.
      run = runs ? (runs[cmd.object_id] || [cmd]) : [cmd]
      params.each_with_index do |p, j|
        target = run[j]
        if target
          target.instance_variable_set(:@code, code)
          target.instance_variable_set(:@parameters, [p])
        else
          target = make_cmd(cmd.class, code, cmd_indent(cmd), [p])
        end
        out.push(target)
        code = c
      end
    else
      out.push(cmd)
    end
  end
  out
end

def dump_parameters(params)
  if params.all? { |e| e.is_a?(String) }
    {
      "json_class" => "TranslatableArray",
      ORIG_KEY => params.map { |s| s.dup.force_encoding("UTF-8") },
      TRAN_KEY => Array.new(params.length, ""),
    }
  else
    wrap_array(params)
  end
end

def jsonify_command(cmd, engine)
  code = cmd_code(cmd)
  params = cmd_params(cmd) || []
  type_name, texty = event_type(engine, code, params)
  h = { "json_class" => cmd.class.name, "type" => type_name }
  h["parameters"] = dump_parameters(params) if texty
  h
end

def apply_parameters(orig_params, entry)
  tp = entry["parameters"]
  return orig_params if tp.nil?
  if tp.is_a?(Array)
    apply_wrapped(orig_params, tp)
  else
    apply_ta(tp, orig_params)
  end
end

def apply_commands(list, tran_list, engine)
  runs = {}
  merged = merge_commands(list, engine, runs)
  merged.each_with_index do |cmd, i|
    t = tran_list[i]
    next unless t.is_a?(Hash)
    params = cmd_params(cmd) || []
    new_params = apply_parameters(params, t)
    cmd.instance_variable_set(:@parameters, new_params) unless new_params.equal?(params)
  end
  split_commands(merged, engine, runs)
end

# ---------- object walkers ----------

def jsonify_value(v, engine)
  if v.is_a?(String) || v.is_a?(Numeric) || v == true || v == false || v.nil?
    v
  else
    jsonify(v, engine)
  end
end

def jsonify(obj, engine)
  cls = obj.class.name
  fields = Rules.for(engine)[cls]
  return { "json_class" => cls } if fields.nil?
  h = NO_CLASS_MARKER[engine] && NO_CLASS_MARKER[engine].include?(cls) ? {} : { "json_class" => cls }
  fields.each do |key, kind, ivar|
    v = obj.instance_variable_get(ivar_sym(key, ivar))
    case kind
    when :string    then h[key] = ts(v)
    when :str_array then h[key] = v.nil? ? nil : wrap_array(v)
    when :object    then h[key] = v.nil? ? nil : jsonify(v, engine)
    when :hash      then h[key] = (v || {}).sort.map { |k, e| [k, jsonify_value(e, engine)] }
    when :list      then h[key] = (v || []).map { |e| e.nil? ? nil : jsonify_value(e, engine) }
    when :commands  then h[key] = merge_commands(v || [], engine).map { |c| jsonify_command(c, engine) }
    end
  end
  h
end

def apply_json(obj, json, engine)
  return obj if json.nil? || obj.nil?
  fields = Rules.for(engine)[obj.class.name]
  return obj if fields.nil?
  fields.each do |key, kind, ivar|
    j = json[key]
    next if j.nil?
    iv = ivar_sym(key, ivar)
    v = obj.instance_variable_get(iv)
    case kind
    when :string
      obj.instance_variable_set(iv, apply_ts(j, v)) if v.is_a?(String) && j.is_a?(Hash)
    when :str_array
      obj.instance_variable_set(iv, apply_wrapped(v, j)) if v.is_a?(Array) && j.is_a?(Array)
    when :object
      apply_json(v, j, engine) if v
    when :hash
      if v.is_a?(Hash) && j.is_a?(Array)
        j.each do |k, e|
          o = v[k]
          apply_json(o, e, engine) if o && e.is_a?(Hash)
        end
      end
    when :list
      if v.is_a?(Array) && j.is_a?(Array)
        v.zip(j) { |o, e| apply_json(o, e, engine) if o && e.is_a?(Hash) }
      end
    when :commands
      obj.instance_variable_set(iv, apply_commands(v || [], j, engine)) if j.is_a?(Array)
    end
  end
  obj
end

# ---------- file operations ----------

def sub_json_ext(path)
  path.sub(/\.[^.]+\z/, ".json")
end

def dump_file(path, dest)
  print "Dumping #{path}... "
  $stdout.flush
  json_path = File.join(dest, File.basename(sub_json_ext(path)))

  if File.exist?(json_path)
    puts ""
    puts "Warning: The translation file #{json_path} already exists, overwrite? a/y/N"
    $stdout.flush
    answer = STDIN.gets.to_s.strip
    if answer == "a"
      puts "Aborting"
      exit 0
    elsif answer != "y"
      puts "skipping"
      return
    end
  end

  engine = engine_of(path)
  data = Model.load(path)

  if Scripts.data?(data)
    json = Scripts.dump_entries(data, File.join(dest, "scripts"))
  elsif data.is_a?(Hash)
    json = data.sort.map { |k, v| [k, jsonify_value(v, engine)] }
  elsif data.is_a?(Array)
    json = data.map.with_index { |e, i| [i, e.nil? ? nil : jsonify_value(e, engine)] }
  else
    json = jsonify_value(data, engine)
  end

  File.binwrite(json_path, JSON.pretty_generate(json))
  puts "ok"
end

def translate_file(path, dest)
  print "Translating #{path}... "
  $stdout.flush
  json_path = sub_json_ext(path)
  unless File.file?(json_path)
    puts "translation missing, ignoring."
    return
  end

  engine = engine_of(path)
  original = Model.load(path)
  translation = JSON.parse(File.binread(json_path))

  if Scripts.data?(original)
    if !translation.is_a?(Array) || translation.length != original.length
      error("Scripts translation has #{translation.is_a?(Array) ? translation.length : 'unknown'} entries, data has #{original.length}")
    end
    original = original.zip(translation).map do |triplet, entry|
      Scripts.apply_triplet(triplet, entry)
    end
  elsif original.is_a?(Hash)
    translation.each do |k, j|
      o = original[k]
      apply_json(o, j, engine) if o && j.is_a?(Hash)
    end
  elsif original.is_a?(Array)
    original = original.zip(translation).map do |o, pair|
      if !o.nil? && pair.is_a?(Array) && pair[1].is_a?(Hash)
        apply_json(o, pair[1], engine)
      end
      o
    end
  else
    apply_json(original, translation, engine)
  end

  tran_path = File.join(dest, File.basename(path))
  if File.exist?(tran_path)
    same = begin
      File.realpath(tran_path) == File.realpath(path)
    rescue StandardError
      false
    end
    if same
      puts ""
      puts "Warning: The destination is the same as the original data file, overwrite? a/y/N?"
      $stdout.flush
      answer = STDIN.gets.to_s.strip
      if answer == "a"
        puts "Aborting"
        exit 0
      elsif answer != "y"
        puts "Skipping #{path}"
        return
      end
    end
  end

  File.binwrite(tran_path, Marshal.dump(original))
  puts "ok"
end

# ---------- CLI ----------

def usage
  puts "Usage: ruby rmjson.rb [flags]"
  puts " --dump=<file>       Dump a data file (or glob) to translatable JSON."
  puts " --translate=<file>  Apply a sibling .json translation to a data file."
  puts " --dest=<dir>        Destination folder for generated files. Default: ."
  puts " --help              Show this text."
end

dump_args = []
translate_args = []
dest = "."
show_help = false

ARGV.each do |arg|
  key, value = arg.split("=", 2)
  case key
  when "--help", "-h" then show_help = true
  when "--dump"
    error("missing value for --dump") if value.nil?
    dump_args.push(value)
  when "--translate"
    error("missing value for --translate") if value.nil?
    translate_args.push(value)
  when "--dest"
    error("missing value for --dest") if value.nil?
    dest = value
  else
    error("unknown argument #{arg}")
  end
end

if show_help || (dump_args.empty? && translate_args.empty?)
  usage
  exit(show_help ? 0 : 1)
end

error("--dest #{dest} is not an existing directory") unless File.directory?(dest)

# Convert raised errors (translation mismatches, script control mismatches,
# marshal failures) into single-line diagnostics + exit 1 (spec §5).
begin
  dump_args.each do |pattern|
    files = Dir.glob(pattern).sort
    error("no files match #{pattern}") if files.empty?
    files.each { |f| dump_file(f, dest) }
  end
  translate_args.each do |pattern|
    files = Dir.glob(pattern).sort
    error("no files match #{pattern}") if files.empty?
    files.each { |f| translate_file(f, dest) }
  end
rescue SystemExit
  raise
rescue StandardError => e
  puts "Error: #{e.class}: #{e.message}"
  exit 1
end
