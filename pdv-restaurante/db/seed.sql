-- ============================================================================
--  PDV RESTAURANTE — Seed de exemplo (rodar APÓS schema.sql)
--  Cenário: restaurante à la carte com cozinha + bar, salão e varanda.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Configuração e cadastros
-- ----------------------------------------------------------------------------
INSERT INTO config_restaurante (id, nome, gorjeta_percentual, baixa_estoque_em)
VALUES (1, 'Casa do Fogo — Restaurante', 10.00, 'ENVIO');

INSERT INTO unidade_medida (id, sigla, nome, tipo) VALUES
  (1, 'kg',   'Quilograma', 'MASSA'),
  (2, 'g',    'Grama',      'MASSA'),
  (3, 'l',    'Litro',      'VOLUME'),
  (4, 'ml',   'Mililitro',  'VOLUME'),
  (5, 'un',   'Unidade',    'UNIDADE'),
  (6, 'saco', 'Saco',       'UNIDADE'),
  (7, 'cx',   'Caixa',      'UNIDADE');

INSERT INTO fornecedor (id, nome, cnpj, telefone, prazo_entrega_dias) VALUES
  (1, 'Andrade Carnes',        '12.345.678/0001-90', '(11) 98888-1111', 1),
  (2, 'Hortifruti Central',    '23.456.789/0001-91', '(11) 97777-2222', 1),
  (3, 'Bebidas Sul Ltda',      '34.567.890/0001-92', '(11) 96666-3333', 2),
  (4, 'Mercado Atacadista Bom Preço', '45.678.901/0001-93', '(11) 95555-4444', 0);

INSERT INTO usuario (id, nome, email, pin_hash, papel) VALUES
  (1, 'Ana Souza',      'ana@casadofogo.com',     'TROCAR-POR-BCRYPT-pin1111', 'GARCOM'),
  (2, 'Bruno Lima',     'bruno@casadofogo.com',   'TROCAR-POR-BCRYPT-pin2222', 'GARCOM'),
  (3, 'Carla Dias',     'carla@casadofogo.com',   'TROCAR-POR-BCRYPT-pin3333', 'CAIXA'),
  (4, 'Roberto Chef',   'roberto@casadofogo.com', 'TROCAR-POR-BCRYPT-pin4444', 'COZINHEIRO'),
  (5, 'Diego Manager',  'diego@casadofogo.com',   'TROCAR-POR-BCRYPT-pin5555', 'GERENTE');

-- ----------------------------------------------------------------------------
-- Estações de produção + impressoras (uma por estação)
-- ----------------------------------------------------------------------------
INSERT INTO estacao (id, nome, tipo) VALUES
  (1, 'Cozinha', 'COZINHA'),
  (2, 'Bar',     'BAR');

INSERT INTO impressora (estacao_id, nome, ip, porta, papel_mm) VALUES
  (1, 'Epson TM-T20 — Cozinha', '192.168.15.201', 9100, 80),
  (2, 'Elgin i9 — Bar',         '192.168.15.202', 9100, 80);

-- ----------------------------------------------------------------------------
-- Cardápio: categorias (cada uma aponta p/ a estação de impressão)
-- ----------------------------------------------------------------------------
INSERT INTO categoria (id, nome, estacao_id, sort) VALUES
  (1, 'Entradas',        1, 1),
  (2, 'Pratos Principais', 1, 2),
  (3, 'Sobremesas',      1, 3),
  (4, 'Drinks',          2, 4),
  (5, 'Cervejas & Bebidas', 2, 5);

-- ----------------------------------------------------------------------------
-- Insumos (unidade de estoque = unidade usada na ficha técnica)
-- ----------------------------------------------------------------------------
INSERT INTO insumo (id, nome, unidade_estoque_id, unidade_compra_id, fator_compra,
                    custo_unitario, estoque_minimo, estoque_maximo, fornecedor_padrao_id) VALUES
  (1,  'Picanha matura',          1, NULL, 1,  68.00, 5.000, 12.000, 1),
  (2,  'Arroz agulha',            1, 6,   5,   6.20, 10.000, 30.000, 4),  -- saco de 5 kg
  (3,  'Feijão carioca',          1, 6,   1,   7.90, 8.000, 20.000, 4),
  (4,  'Batata pré-frita congel.',1, NULL, 1,   8.50, 12.000, 30.000, 4),
  (5,  'Manteiga sem sal',        1, NULL, 1,  42.00, 3.000, 8.000, 4),
  (6,  'Farofa pronta temperada', 1, NULL, 1,  14.00, 4.000, 10.000, 4),
  (7,  'Alface americana',        5, NULL, 1,   4.50, 8.000, 15.000, 2),
  (8,  'Tomate italiano',         1, NULL, 1,   7.00, 6.000, 15.000, 2),
  (9,  'Cebola',                  1, NULL, 1,   5.40, 4.000, 10.000, 2),
  (10, 'Óleo de soja',            3, NULL, 1,   8.20, 10.000, 20.000, 4),
  (11, 'Queijo muçarela',         1, NULL, 1,  38.00, 6.000, 12.000, 4),
  (12, 'Pão de alho congelado',   5, NULL, 1,   2.80, 20.000, 40.000, 4),
  (13, 'Limão taiti',             5, NULL, 1,   0.60, 40.000, 100.000, 2),
  (14, 'Açúcar refinado',         1, NULL, 1,   4.80, 5.000, 12.000, 4),
  (15, 'Cachaça premium',         3, 7,   6,  35.00, 4.000, 8.000, 3),   -- cx 6 garrafas
  (16, 'Hortelã (maço)',          5, NULL, 1,   1.50, 5.000, 10.000, 2),
  (17, 'Cerveja long neck 355ml', 5, 7,   12,  4.60, 36.000, 96.000, 3), -- cx 12 un
  (18, 'Leite condensado 395g',   5, NULL, 1,   6.90, 12.000, 24.000, 4),
  (19, 'Leite integral',          3, NULL, 1,   5.40, 8.000, 20.000, 4),
  (20, 'Ovos brancos',            5, NULL, 1,   0.90, 30.000, 60.000, 4),
  (21, 'Café torrado e moído',    1, NULL, 1,  45.00, 3.000, 6.000, 4),
  (22, 'Chocolate belga 55%',     1, NULL, 1,  68.00, 1.000, 4.000, 4),
  (23, 'Peito de frango',         1, NULL, 1,  16.90, 5.000, 12.000, 1),
  (24, 'Farinha panko',           1, NULL, 1,  12.50, 2.000, 5.000, 4),
  (25, 'Molho de tomate pronto',  3, NULL, 1,   9.80, 4.000, 10.000, 4),
  (26, 'Farinha de trigo',        1, NULL, 1,   4.60, 2.000, 6.000, 4);

-- Estoque inicial (nota de compra de hoje)
INSERT INTO estoque_movimento (insumo_id, tipo, quantidade, custo_unitario, origem, usuario_id, motivo) VALUES
  (1, 'ENTRADA', 5.500, 68.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 10231 — Andrade Carnes'),
  (2, 'ENTRADA', 20.000, 6.20, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (3, 'ENTRADA', 12.000, 7.90, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (4, 'ENTRADA', 15.000, 8.50, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (5, 'ENTRADA', 4.000, 42.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (6, 'ENTRADA', 5.000, 14.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (7, 'ENTRADA', 10.000, 4.50, 'COMPRA_FORNECEDOR', 5, 'Feira — Hortifruti Central'),
  (8, 'ENTRADA', 6.000, 7.00, 'COMPRA_FORNECEDOR', 5, 'Feira — Hortifruti Central'),
  (9, 'ENTRADA', 6.000, 5.40, 'COMPRA_FORNECEDOR', 5, 'Feira — Hortifruti Central'),
  (10,'ENTRADA', 12.000, 8.20, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (11,'ENTRADA', 8.000, 38.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (12,'ENTRADA', 24.000, 2.80, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (13,'ENTRADA', 90.000, 0.60, 'COMPRA_FORNECEDOR', 5, 'Feira — Hortifruti Central'),
  (14,'ENTRADA', 8.000, 4.80, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (15,'ENTRADA', 6.000, 35.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 5567 — Bebidas Sul'),
  (16,'ENTRADA', 8.000, 1.50, 'COMPRA_FORNECEDOR', 5, 'Feira — Hortifruti Central'),
  (17,'ENTRADA', 48.000, 4.60, 'COMPRA_FORNECEDOR', 5, 'NF-e 5567 — Bebidas Sul (4 cx x12)'),
  (18,'ENTRADA', 15.000, 6.90, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (19,'ENTRADA', 10.000, 5.40, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (20,'ENTRADA', 40.000, 0.90, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (21,'ENTRADA', 2.800, 45.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),  -- já abaixo do mínimo (3 kg)
  (22,'ENTRADA', 2.000, 68.00, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (23,'ENTRADA', 6.000, 16.90, 'COMPRA_FORNECEDOR', 5, 'NF-e 10231 — Andrade Carnes'),
  (24,'ENTRADA', 1.200, 12.50, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),  -- abaixo do mínimo (2 kg)
  (25,'ENTRADA', 4.000, 9.80, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871'),
  (26,'ENTRADA', 3.000, 4.60, 'COMPRA_FORNECEDOR', 5, 'NF-e 9871');

-- ----------------------------------------------------------------------------
-- Produtos do cardápio
-- ----------------------------------------------------------------------------
INSERT INTO produto (id, nome, descricao, categoria_id, preco, insumo_vinculado_id, unidade_porcao) VALUES
  (1, 'Bruschetta Caprese',   'Pão de alho, tomate italiano, muçarela de búfala e azeite', 1, 26.00, NULL, '4 unidades'),
  (2, 'Picanha na Chapa',     'Picanha matura grelhada, arroz, feijão, farofa e batata frita. Serve 2 pessoas.', 2, 129.90, NULL, '500 g'),
  (3, 'Parmegiana de Frango', 'Filé de frango empanado, molho pomodoro, muçarela, arroz e fritas', 2, 54.90, NULL, 'prato ~380 g'),
  (4, 'Petit Gâteau',         'Bolinho de chocolate belga com sorvete de creme', 3, 24.90, NULL, '1 unidade'),
  (5, 'Pudim de Leite da Vovó', 'Receita da casa, corte de 120 g', 3, 14.90, NULL, '1 fatia'),
  (6, 'Caipirinha Tradicional', 'Limão taiti, cachaça premium e açúcar', 4, 19.90, NULL, 'copo 350 ml'),
  (7, 'Long Neck 355 ml',     'Cerveja pilsen gelada', 5, 11.90, 17, '1 unidade'),
  (8, 'Espresso',             'Café coado na hora', 5, 6.50, NULL, 'xícara 50 ml');

-- ----------------------------------------------------------------------------
-- Fichas técnicas — quantidade LÍQUIDA na unidade de estoque do insumo.
-- perca_pct = desperdício no pré-preparo (a baixa usa qtd/(1-perca)).
-- ----------------------------------------------------------------------------
INSERT INTO ficha_tecnica (id, produto_id, rendimento, unidade_rendimento, observacoes) VALUES
  (1, 1, 1,  'bruschettas', NULL),
  (2, 2, 1,  'porção', 'Peso da picanha é o bruto pré-grelha'),
  (3, 3, 1,  'prato', NULL),
  (4, 4, 4,  'petit gateaux', 'Massa rende 4 unidades; assar 8 min'),
  (5, 5, 10, 'fatias de 120 g', 'Forma de fundo removível 24 cm'),
  (6, 6, 1,  'copo', NULL),
  (7, 8, 1,  'xícara', NULL);
-- Obs.: Long Neck (produto 7) NÃO tem ficha — usa vínculo direto com insumo 17.

INSERT INTO ficha_tecnica_item (ficha_tecnica_id, insumo_id, quantidade, perca_pct, observacao) VALUES
  (1, 12, 2.000,  0, '2 fatias'),
  (1, 8,  0.100, 12, 'sem semente, em cubos'),
  (1, 11, 0.060,  0, NULL),
  (1, 10, 0.008,  0, 'substituir por azeite quando chegar'),
  (2, 1,  0.500, 12, 'gordura aparada — perder 12% no resfriamento'),
  (2, 2,  0.150,  0, '150 g cozido'),
  (2, 3,  0.080,  0, NULL),
  (2, 4,  0.300,  6, 'batata rústica'),
  (2, 6,  0.060,  0, NULL),
  (2, 5,  0.030,  0, 'finalizar manteiga na chapa'),
  (3, 23, 0.220,  8, 'limpar e bater para uniformizar'),
  (3, 10, 0.020,  0, 'fritura'),
  (3, 24, 0.060,  0, NULL),
  (3, 25, 0.150,  0, NULL),
  (3, 11, 0.080,  0, NULL),
  (3, 2,  0.120,  0, NULL),
  (3, 4,  0.200,  6, NULL),
  (4, 22, 0.050,  0, NULL),
  (4, 5,  0.045,  0, NULL),
  (4, 20, 1.500,  0, '1 gema + 1 clara'),
  (4, 14, 0.025,  0, NULL),
  (4, 26, 0.030,  0, NULL),
  (5, 18, 1.000,  0, '1 lata'),
  (5, 19, 0.390,  0, 'medida da lata de leite condensado'),
  (5, 20, 6.000,  0, NULL),
  (5, 14, 0.100,  0, 'calda do caramelo'),
  (6, 13, 1.000, 15, 'rachar o limão com o açúcar antes da cachaça'),
  (6, 14, 0.030,  0, NULL),
  (6, 15, 0.070,  0, '70 ml'),
  (7, 21, 0.010,  3, 'dose padrão do portafiltro');

-- ----------------------------------------------------------------------------
-- Salão: mesas (com posição para o mapa visual)
-- ----------------------------------------------------------------------------
INSERT INTO area (id, nome) VALUES (1, 'Salão'), (2, 'Varanda');

INSERT INTO mesa (id, numero, area_id, capacidade, pos_x, pos_y) VALUES
  (1, 1, 1, 2, 1, 1), (2, 2, 1, 4, 2, 1), (3, 3, 1, 4, 3, 1), (4, 4, 1, 6, 4, 1),
  (5, 5, 1, 4, 1, 2), (6, 6, 1, 2, 2, 2), (7, 7, 1, 4, 3, 2), (8, 8, 1, 8, 4, 2),
  (9, 9, 2, 4, 1, 3), (10, 10, 2, 4, 2, 3), (11, 11, 2, 2, 3, 3), (12, 12, 2, 6, 4, 3);

UPDATE mesa SET status = 'RESERVADA' WHERE id = 9;  -- reserva de aniversário 20h

-- ----------------------------------------------------------------------------
-- Operação em andamento
-- ----------------------------------------------------------------------------
-- Mesa 3: pedido aberto há ~40 min (itens ainda RASCUNHO — o teste envia)
INSERT INTO pedido (id, mesa_id, garcom_id, observacao, aberto_em)
VALUES (1, 3, 1, 'Mesa de aniversário — sobremesa por conta da casa', now() - interval '40 minutes');

INSERT INTO pedido_item (id, pedido_id, produto_id, quantidade, preco_unitario, status, observacao, ponto_carne) VALUES
  (1, 1, 1, 1, 26.00,  'RASCUNHO', 'sem manjericão, caprese', NULL),
  (2, 1, 6, 2, 19.90,  'RASCUNHO', 'pouco açúcar, limão sem casca branca', NULL),
  (3, 1, 2, 1, 129.90, 'RASCUNHO', 'sal grosso à parte', 'ao ponto'),
  (4, 1, 3, 1, 54.90,  'RASCUNHO', 'sem cebola no molho', NULL),
  (5, 1, 7, 2, 11.90,  'RASCUNHO', NULL, NULL);

-- Mesa 5: pedido com conta DIVIDIDA POR ITEM (rascunho; demonstra rateio)
INSERT INTO pedido (id, mesa_id, garcom_id, aberto_em)
VALUES (2, 5, 2, now() - interval '15 minutes');

INSERT INTO pedido_item (id, pedido_id, produto_id, quantidade, preco_unitario, status, observacao) VALUES
  (6, 2, 1, 1, 26.00, 'RASCUNHO', NULL),
  (7, 2, 8, 2,  6.50, 'RASCUNHO', 'um sem cafeína');

-- Contas da mesa 5:
--   conta 2 "Bruno" leva 1 bruschetta e 1 espresso (divisão por item);
--   conta 3 "Maria" é divisão igualitária (valor fixo).
INSERT INTO conta (id, pedido_id, descricao, incluir_servico, servico_pct) VALUES
  (2, 2, 'Bruno (por item)', TRUE, 10.00),
  (3, 2, 'Maria (1/2 igualitária)', FALSE, 10.00);

INSERT INTO conta_item (conta_id, pedido_item_id, quantidade) VALUES
  (2, 6, 1),
  (2, 7, 1);

UPDATE conta SET valor_rateio = 19.58 WHERE id = 3;  -- metade do total já com serviço

-- ----------------------------------------------------------------------------
-- Caixa aberto (Carla, 18h, fundo R$ 200) + movimento de sangria
-- ----------------------------------------------------------------------------
INSERT INTO caixa (id, operador_id, valor_inicial) VALUES (1, 3, 200.00);

INSERT INTO caixa_movimento (caixa_id, tipo, valor, motivo, usuario_id) VALUES
  (1, 'SANGRIA', 150.00, 'Depósito bancário — intervalo', 3);

-- Pagamentos parciais já feitos na conta 2 (Bruno pagou o espresso em dinheiro com troco)
INSERT INTO pagamento (conta_id, caixa_id, forma, valor, valor_troco, referencia) VALUES
  (2, 1, 'DINHEIRO', 10.00, 3.50, NULL);

-- ----------------------------------------------------------------------------
-- Avança as sequences das tabelas que receberam IDs explícitos neste seed
-- ----------------------------------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'usuario','unidade_medida','fornecedor','estacao','impressora','categoria',
    'insumo','ficha_tecnica','ficha_tecnica_item','produto','area','mesa',
    'pedido','pedido_item','conta','caixa'
  ] LOOP
    EXECUTE format(
      'SELECT setval(pg_get_serial_sequence(%L, %L), GREATEST((SELECT COALESCE(MAX(id),1) FROM %I), 1))',
      t, 'id', t);
  END LOOP;
END $$;

COMMIT;
