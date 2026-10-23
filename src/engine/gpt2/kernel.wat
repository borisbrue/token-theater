;; Rechenkern der GPT-2-Engine (SPEC-0008 §3.5, CON-0019). Übersetzen: npm run build:kernel.
;; Alle Adressen sind Byte-Adressen in env.memory; das Modul vergrößert den Speicher nie.
(module
  (import "env" "memory" (memory 1))

  ;; out[t] = Σ_c h[c] · w[t·k + c] für t < n (Float32, k Werte je Zeile)
  (func (export "unembed") (param $h i32) (param $w i32) (param $out i32) (param $n i32) (param $k i32)
    (local $t i32) (local $c i32) (local $kb i32) (local $kb8 i32) (local $a v128) (local $b v128) (local $s f32)
    (local.set $kb (i32.shl (local.get $k) (i32.const 2)))
    (local.set $kb8 (i32.shl (i32.and (local.get $k) (i32.const -8)) (i32.const 2)))
    (block $done
      (br_if $done (i32.eqz (local.get $n)))
      (loop $T
        (local.set $a (v128.const f32x4 0 0 0 0))
        (local.set $b (v128.const f32x4 0 0 0 0))
        (local.set $c (i32.const 0))
        (if (local.get $kb8)
          (then
            (loop $C
              (local.set $a (f32x4.add (local.get $a)
                (f32x4.mul (v128.load (i32.add (local.get $h) (local.get $c)))
                           (v128.load (i32.add (local.get $w) (local.get $c))))))
              (local.set $b (f32x4.add (local.get $b)
                (f32x4.mul (v128.load offset=16 (i32.add (local.get $h) (local.get $c)))
                           (v128.load offset=16 (i32.add (local.get $w) (local.get $c))))))
              (br_if $C (i32.lt_u (local.tee $c (i32.add (local.get $c) (i32.const 32))) (local.get $kb8))))))
        (local.set $a (f32x4.add (local.get $a) (local.get $b)))
        (local.set $s
          (f32.add (f32.add (f32x4.extract_lane 0 (local.get $a)) (f32x4.extract_lane 1 (local.get $a)))
                   (f32.add (f32x4.extract_lane 2 (local.get $a)) (f32x4.extract_lane 3 (local.get $a)))))
        (block $tail
          (loop $R
            (br_if $tail (i32.ge_u (local.get $c) (local.get $kb)))
            (local.set $s (f32.add (local.get $s)
              (f32.mul (f32.load (i32.add (local.get $h) (local.get $c)))
                       (f32.load (i32.add (local.get $w) (local.get $c))))))
            (local.set $c (i32.add (local.get $c) (i32.const 4)))
            (br $R)))
        (f32.store (local.get $out) (local.get $s))
        (local.set $out (i32.add (local.get $out) (i32.const 4)))
        (local.set $w (i32.add (local.get $w) (local.get $kb)))
        (br_if $T (i32.lt_u (local.tee $t (i32.add (local.get $t) (i32.const 1))) (local.get $n))))))

  ;; y = x · W + b; x [rows, inputs], W [inputs, outputs], Summe in Reihenfolge von i (Float32)
  (func (export "affine") (param $x i32) (param $rows i32) (param $inputs i32) (param $w i32) (param $b i32) (param $outputs i32) (param $out i32)
    (local $r i32) (local $i i32) (local $o i32) (local $ob i32) (local $ob4 i32) (local $wrow i32) (local $xi f32) (local $xs v128)
    (local.set $ob (i32.shl (local.get $outputs) (i32.const 2)))
    (local.set $ob4 (i32.shl (i32.and (local.get $outputs) (i32.const -4)) (i32.const 2)))
    (block $done
      (br_if $done (i32.or (i32.eqz (local.get $rows)) (i32.eqz (local.get $outputs))))
      (loop $Rows
        (memory.copy (local.get $out) (local.get $b) (local.get $ob))
        (local.set $wrow (local.get $w))
        (local.set $i (i32.const 0))
        (block $inDone
          (br_if $inDone (i32.eqz (local.get $inputs)))
          (loop $I
            (local.set $xi (f32.load (i32.add (local.get $x) (i32.shl (local.get $i) (i32.const 2)))))
            (local.set $xs (f32x4.splat (local.get $xi)))
            (local.set $o (i32.const 0))
            (if (local.get $ob4)
              (then
                (loop $O
                  (v128.store (i32.add (local.get $out) (local.get $o))
                    (f32x4.add (v128.load (i32.add (local.get $out) (local.get $o)))
                               (f32x4.mul (local.get $xs) (v128.load (i32.add (local.get $wrow) (local.get $o))))))
                  (br_if $O (i32.lt_u (local.tee $o (i32.add (local.get $o) (i32.const 16))) (local.get $ob4))))))
            (block $oDone
              (loop $OT
                (br_if $oDone (i32.ge_u (local.get $o) (local.get $ob)))
                (f32.store (i32.add (local.get $out) (local.get $o))
                  (f32.add (f32.load (i32.add (local.get $out) (local.get $o)))
                           (f32.mul (local.get $xi) (f32.load (i32.add (local.get $wrow) (local.get $o))))))
                (local.set $o (i32.add (local.get $o) (i32.const 4)))
                (br $OT)))
            (local.set $wrow (i32.add (local.get $wrow) (local.get $ob)))
            (br_if $I (i32.lt_u (local.tee $i (i32.add (local.get $i) (i32.const 1))) (local.get $inputs)))))
        (local.set $x (i32.add (local.get $x) (i32.shl (local.get $inputs) (i32.const 2))))
        (local.set $out (i32.add (local.get $out) (local.get $ob)))
        (br_if $Rows (i32.lt_u (local.tee $r (i32.add (local.get $r) (i32.const 1))) (local.get $rows)))))))
